use std::collections::HashMap;
use std::fs::File;
use std::io::{Seek, SeekFrom, Write};
use std::path::Path;

#[derive(Clone, Copy, PartialEq, Eq)]
enum StreamKind {
    H264,
    Aac,
}

#[derive(Clone)]
struct Sample {
    offset: u64,
    size: u32,
    dts: u64,
    cts_offset: i64,
    key: bool,
}

#[derive(Clone)]
struct AvcConfig {
    sps: Vec<u8>,
    pps: Vec<u8>,
    width: u16,
    height: u16,
}

#[derive(Clone)]
struct AacConfig {
    profile: u8,
    sample_rate_index: u8,
    sample_rate: u32,
    channels: u8,
}

pub struct TsMp4Muxer {
    file: File,
    mdat_size_pos: u64,
    media_written: u64,
    pmt_pid: Option<u16>,
    streams: HashMap<u16, StreamKind>,
    pes: HashMap<u16, Vec<u8>>,
    video: Vec<Sample>,
    audio: Vec<Sample>,
    avc: Option<AvcConfig>,
    aac: Option<AacConfig>,
    video_base_dts: Option<u64>,
    video_dts_shift: u64,
    last_video_dts: Option<u64>,
}

impl TsMp4Muxer {
    pub fn create(path: &Path) -> Result<Self, String> {
        let mut file = File::create(path).map_err(|e| format!("create mp4: {e}"))?;
        file.write_all(&box_bytes(b"ftyp", &ftyp_payload()))
            .map_err(|e| format!("write ftyp: {e}"))?;
        file.write_all(&1u32.to_be_bytes())
            .map_err(|e| format!("write mdat size: {e}"))?;
        file.write_all(b"mdat")
            .map_err(|e| format!("write mdat type: {e}"))?;
        let mdat_size_pos = file
            .stream_position()
            .map_err(|e| format!("mdat position: {e}"))?;
        file.write_all(&0u64.to_be_bytes())
            .map_err(|e| format!("write mdat large size: {e}"))?;
        Ok(Self {
            file,
            mdat_size_pos,
            media_written: 0,
            pmt_pid: None,
            streams: HashMap::new(),
            pes: HashMap::new(),
            video: Vec::new(),
            audio: Vec::new(),
            avc: None,
            aac: None,
            video_base_dts: None,
            video_dts_shift: 0,
            last_video_dts: None,
        })
    }

    pub fn push_ts(&mut self, data: &[u8]) -> Result<(), String> {
        let Some((sync_offset, packet_size)) = detect_ts_layout(data) else {
            return Ok(());
        };
        let mut pos = sync_offset;
        while pos + 188 <= data.len() {
            if data[pos] != 0x47 {
                pos += 1;
                continue;
            }
            let pkt = &data[pos..pos + 188];
            let pusi = pkt[1] & 0x40 != 0;
            let pid = (((pkt[1] & 0x1f) as u16) << 8) | pkt[2] as u16;
            let afc = (pkt[3] >> 4) & 0x03;
            if afc == 0 || afc == 2 {
                pos += packet_size;
                continue;
            }
            let mut off = 4usize;
            if afc == 3 {
                if off >= pkt.len() {
                    pos += packet_size;
                    continue;
                }
                off += 1 + pkt[off] as usize;
            }
            if off >= pkt.len() {
                pos += packet_size;
                continue;
            }
            let payload = &pkt[off..];
            if pid == 0 {
                if let Some(pmt) = parse_pat(payload, pusi) {
                    self.pmt_pid = Some(pmt);
                }
                pos += packet_size;
                continue;
            }
            if Some(pid) == self.pmt_pid {
                for (stream_pid, kind) in parse_pmt(payload, pusi) {
                    self.streams.insert(stream_pid, kind);
                }
                pos += packet_size;
                continue;
            }
            if !self.streams.contains_key(&pid) {
                pos += packet_size;
                continue;
            }
            if pusi {
                self.flush_pid(pid)?;
                self.pes.insert(pid, Vec::new());
            }
            if let Some(buf) = self.pes.get_mut(&pid) {
                buf.extend_from_slice(payload);
            }
            pos += packet_size;
        }
        Ok(())
    }

    pub fn finish(mut self) -> Result<u64, String> {
        let pids: Vec<u16> = self.pes.keys().copied().collect();
        for pid in pids {
            self.flush_pid(pid)?;
        }

        if self.video.is_empty() {
            return Err("TS-HLS 中没有可封装的 H.264 视频轨".to_string());
        }
        if self.avc.is_none() {
            return Err("TS-HLS 缺少 H.264 SPS/PPS，无法写入 MP4".to_string());
        }

        let end = self
            .file
            .stream_position()
            .map_err(|e| format!("mp4 end position: {e}"))?;
        self.file
            .seek(SeekFrom::Start(self.mdat_size_pos))
            .map_err(|e| format!("seek mdat size: {e}"))?;
        self.file
            .write_all(&(self.media_written + 16).to_be_bytes())
            .map_err(|e| format!("patch mdat size: {e}"))?;
        self.file
            .seek(SeekFrom::Start(end))
            .map_err(|e| format!("seek mp4 end: {e}"))?;

        let moov = self.moov()?;
        self.file
            .write_all(&moov)
            .map_err(|e| format!("write moov: {e}"))?;
        self.file.flush().map_err(|e| format!("flush mp4: {e}"))?;
        Ok(self.media_written)
    }

    fn flush_pid(&mut self, pid: u16) -> Result<(), String> {
        let Some(buf) = self.pes.remove(&pid) else {
            return Ok(());
        };
        if buf.len() < 9 || !buf.starts_with(&[0, 0, 1]) {
            return Ok(());
        }
        let kind = self.streams.get(&pid).copied();
        let Some((pts, dts, payload)) = parse_pes(&buf) else {
            return Ok(());
        };
        match kind {
            Some(StreamKind::H264) => self.push_h264_pes(payload, pts, dts)?,
            Some(StreamKind::Aac) => self.push_aac_pes(payload)?,
            None => {}
        }
        Ok(())
    }

    fn write_media(&mut self, data: &[u8]) -> Result<(u64, u32), String> {
        let offset = self
            .file
            .stream_position()
            .map_err(|e| format!("sample position: {e}"))?;
        self.file
            .write_all(data)
            .map_err(|e| format!("write sample: {e}"))?;
        self.media_written += data.len() as u64;
        Ok((offset, data.len() as u32))
    }

    fn push_h264_pes(&mut self, payload: &[u8], pts: Option<u64>, dts: Option<u64>) -> Result<(), String> {
        let Some(pts) = pts else {
            return Ok(());
        };
        let dts = dts.unwrap_or(pts);
        let base = *self.video_base_dts.get_or_insert(dts);
        let mut norm_dts = dts.saturating_sub(base) + self.video_dts_shift;
        if let Some(last) = self.last_video_dts {
            if norm_dts <= last {
                let next = last + 3000;
                self.video_dts_shift += next - norm_dts;
                norm_dts = next;
            }
        }
        let cts_offset = pts as i64 - dts as i64;
        let mut sample = Vec::new();
        let mut key = false;
        for nal in split_annexb(payload) {
            if nal.is_empty() {
                continue;
            }
            let nal_type = nal[0] & 0x1f;
            match nal_type {
                7 => {
                    let sps = nal.to_vec();
                    let (w, h) = parse_sps_dimensions(&sps).unwrap_or((1920, 1080));
                    let mut cfg = self.avc.take().unwrap_or(AvcConfig {
                        sps: Vec::new(),
                        pps: Vec::new(),
                        width: w,
                        height: h,
                    });
                    cfg.sps = sps;
                    cfg.width = w;
                    cfg.height = h;
                    self.avc = Some(cfg);
                }
                8 => {
                    let mut cfg = self.avc.take().unwrap_or(AvcConfig {
                        sps: Vec::new(),
                        pps: Vec::new(),
                        width: 1920,
                        height: 1080,
                    });
                    cfg.pps = nal.to_vec();
                    self.avc = Some(cfg);
                }
                9 => {}
                5 => {
                    key = true;
                    write_len_nal(&mut sample, nal);
                }
                _ => write_len_nal(&mut sample, nal),
            }
        }
        if sample.is_empty() {
            return Ok(());
        }
        let (offset, size) = self.write_media(&sample)?;
        self.video.push(Sample {
            offset,
            size,
            dts: norm_dts,
            cts_offset,
            key,
        });
        self.last_video_dts = Some(norm_dts);
        Ok(())
    }

    fn push_aac_pes(&mut self, mut payload: &[u8]) -> Result<(), String> {
        while payload.len() >= 7 {
            let Some(h) = parse_adts(payload) else {
                payload = &payload[1..];
                continue;
            };
            if payload.len() < h.frame_len {
                break;
            }
            self.aac.get_or_insert(AacConfig {
                profile: h.profile,
                sample_rate_index: h.sample_rate_index,
                sample_rate: h.sample_rate,
                channels: h.channels,
            });
            let raw_start = h.header_len;
            let raw_end = h.frame_len;
            if raw_end > raw_start {
                let (offset, size) = self.write_media(&payload[raw_start..raw_end])?;
                self.audio.push(Sample {
                    offset,
                    size,
                    dts: self.audio.len() as u64 * 1024,
                    cts_offset: 0,
                    key: true,
                });
            }
            payload = &payload[h.frame_len..];
        }
        Ok(())
    }

    fn moov(&self) -> Result<Vec<u8>, String> {
        let avc = self.avc.as_ref().ok_or_else(|| "missing avc config".to_string())?;
        let movie_timescale = 1000u32;
        let video_duration = media_duration(&self.video, 90_000);
        let audio_rate = self.aac.as_ref().map(|a| a.sample_rate).unwrap_or(48_000);
        let audio_duration = self.audio.len() as u64 * 1024;
        let movie_duration = ((video_duration * movie_timescale as u64) / 90_000)
            .max((audio_duration * movie_timescale as u64) / audio_rate as u64);

        let mut out = Vec::new();
        out.extend(box_bytes(
            b"mvhd",
            &mvhd_payload(movie_timescale, movie_duration as u32),
        ));
        out.extend(video_trak(1, avc, &self.video, movie_timescale, movie_duration as u32)?);
        if let Some(aac) = &self.aac {
            if !self.audio.is_empty() {
                out.extend(audio_trak(
                    2,
                    aac,
                    &self.audio,
                    movie_timescale,
                    ((audio_duration * movie_timescale as u64) / aac.sample_rate as u64) as u32,
                )?);
            }
        }
        Ok(box_bytes(b"moov", &out))
    }
}

struct AdtsHeader {
    profile: u8,
    sample_rate_index: u8,
    sample_rate: u32,
    channels: u8,
    frame_len: usize,
    header_len: usize,
}

fn parse_adts(data: &[u8]) -> Option<AdtsHeader> {
    if data.len() < 7 || data[0] != 0xff || data[1] & 0xf0 != 0xf0 {
        return None;
    }
    let profile = (data[2] >> 6) & 0x03;
    let sample_rate_index = (data[2] >> 2) & 0x0f;
    let sample_rate = match sample_rate_index {
        0 => 96_000,
        1 => 88_200,
        2 => 64_000,
        3 => 48_000,
        4 => 44_100,
        5 => 32_000,
        6 => 24_000,
        7 => 22_050,
        8 => 16_000,
        9 => 12_000,
        10 => 11_025,
        11 => 8_000,
        12 => 7_350,
        _ => return None,
    };
    let channels = ((data[2] & 0x01) << 2) | ((data[3] >> 6) & 0x03);
    let frame_len =
        (((data[3] & 0x03) as usize) << 11) | ((data[4] as usize) << 3) | ((data[5] >> 5) as usize);
    let protection_absent = data[1] & 0x01 != 0;
    let header_len = if protection_absent { 7 } else { 9 };
    if frame_len < header_len {
        return None;
    }
    Some(AdtsHeader {
        profile,
        sample_rate_index,
        sample_rate,
        channels,
        frame_len,
        header_len,
    })
}

fn parse_pat(payload: &[u8], pusi: bool) -> Option<u16> {
    let section = psi_section(payload, pusi)?;
    if section.len() < 12 || section[0] != 0x00 {
        return None;
    }
    let len = (((section[1] & 0x0f) as usize) << 8) | section[2] as usize;
    let end = (3 + len).saturating_sub(4).min(section.len());
    let mut i = 8;
    while i + 4 <= end {
        let program = ((section[i] as u16) << 8) | section[i + 1] as u16;
        let pid = (((section[i + 2] & 0x1f) as u16) << 8) | section[i + 3] as u16;
        if program != 0 {
            return Some(pid);
        }
        i += 4;
    }
    None
}

fn parse_pmt(payload: &[u8], pusi: bool) -> Vec<(u16, StreamKind)> {
    let Some(section) = psi_section(payload, pusi) else {
        return Vec::new();
    };
    if section.len() < 16 || section[0] != 0x02 {
        return Vec::new();
    }
    let len = (((section[1] & 0x0f) as usize) << 8) | section[2] as usize;
    let program_info_len = (((section[10] & 0x0f) as usize) << 8) | section[11] as usize;
    let mut i = 12 + program_info_len;
    let end = (3 + len).saturating_sub(4).min(section.len());
    let mut out = Vec::new();
    while i + 5 <= end {
        let st = section[i];
        let pid = (((section[i + 1] & 0x1f) as u16) << 8) | section[i + 2] as u16;
        let es_len = (((section[i + 3] & 0x0f) as usize) << 8) | section[i + 4] as usize;
        match st {
            0x1b => out.push((pid, StreamKind::H264)),
            0x0f => out.push((pid, StreamKind::Aac)),
            _ => {}
        }
        i += 5 + es_len;
    }
    out
}

fn psi_section(payload: &[u8], pusi: bool) -> Option<&[u8]> {
    if payload.is_empty() {
        return None;
    }
    if pusi {
        let pointer = payload[0] as usize;
        payload.get(1 + pointer..)
    } else {
        Some(payload)
    }
}

fn parse_pes(buf: &[u8]) -> Option<(Option<u64>, Option<u64>, &[u8])> {
    if buf.len() < 9 || !buf.starts_with(&[0, 0, 1]) {
        return None;
    }
    let flags = buf[7];
    let header_len = buf[8] as usize;
    let payload_start = 9 + header_len;
    if buf.len() < payload_start {
        return None;
    }
    let mut pts = None;
    let mut dts = None;
    let pts_dts = (flags >> 6) & 0x03;
    if (pts_dts == 2 || pts_dts == 3) && buf.len() >= 14 {
        pts = parse_pts(&buf[9..14]);
    }
    if pts_dts == 3 && buf.len() >= 19 {
        dts = parse_pts(&buf[14..19]);
    }
    Some((pts, dts, &buf[payload_start..]))
}

fn detect_ts_layout(data: &[u8]) -> Option<(usize, usize)> {
    for packet_size in [188usize, 192, 204] {
        let scan_limit = data.len().min(packet_size * 2);
        for offset in 0..scan_limit {
            if data.get(offset) != Some(&0x47) {
                continue;
            }
            let mut hits = 0usize;
            for n in 0..5 {
                let pos = offset + n * packet_size;
                if pos < data.len() && data[pos] == 0x47 {
                    hits += 1;
                }
            }
            if hits >= 2 {
                return Some((offset, packet_size));
            }
        }
    }
    None
}

fn parse_pts(b: &[u8]) -> Option<u64> {
    if b.len() < 5 {
        return None;
    }
    Some(
        (((b[0] >> 1) & 0x07) as u64) << 30
            | (b[1] as u64) << 22
            | (((b[2] >> 1) & 0x7f) as u64) << 15
            | (b[3] as u64) << 7
            | ((b[4] >> 1) & 0x7f) as u64,
    )
}

fn split_annexb(data: &[u8]) -> Vec<&[u8]> {
    let mut starts = Vec::new();
    let mut i = 0usize;
    while i + 3 < data.len() {
        if let Some(len) = start_code_len(data, i) {
            starts.push(i + len);
            i += len;
        } else {
            i += 1;
        }
    }
    let mut out = Vec::new();
    for (idx, start) in starts.iter().copied().enumerate() {
        let end = starts
            .get(idx + 1)
            .and_then(|next| find_start_before(data, *next))
            .unwrap_or(data.len());
        if start < end {
            let nal = trim_trailing_zeros(&data[start..end]);
            if !nal.is_empty() {
                out.push(nal);
            }
        }
    }
    out
}

fn start_code_len(data: &[u8], i: usize) -> Option<usize> {
    if i + 3 <= data.len() && data[i..].starts_with(&[0, 0, 1]) {
        Some(3)
    } else if i + 4 <= data.len() && data[i..].starts_with(&[0, 0, 0, 1]) {
        Some(4)
    } else {
        None
    }
}

fn find_start_before(data: &[u8], nal_start: usize) -> Option<usize> {
    let mut i = nal_start.saturating_sub(4);
    while i < nal_start {
        if start_code_len(data, i).is_some() {
            return Some(i);
        }
        i += 1;
    }
    None
}

fn trim_trailing_zeros(mut data: &[u8]) -> &[u8] {
    while data.last() == Some(&0) {
        data = &data[..data.len() - 1];
    }
    data
}

fn write_len_nal(out: &mut Vec<u8>, nal: &[u8]) {
    out.extend_from_slice(&(nal.len() as u32).to_be_bytes());
    out.extend_from_slice(nal);
}

fn media_duration(samples: &[Sample], fallback_delta: u32) -> u64 {
    if samples.is_empty() {
        return 0;
    }
    let deltas = sample_durations(samples, fallback_delta);
    samples.last().unwrap().dts + deltas.last().copied().unwrap_or(fallback_delta) as u64
}

fn sample_durations(samples: &[Sample], fallback_delta: u32) -> Vec<u32> {
    let mut out = Vec::with_capacity(samples.len());
    for i in 0..samples.len() {
        let delta = samples
            .get(i + 1)
            .and_then(|next| next.dts.checked_sub(samples[i].dts))
            .filter(|d| *d > 0)
            .map(|d| d as u32)
            .unwrap_or_else(|| out.last().copied().unwrap_or(fallback_delta));
        out.push(delta);
    }
    out
}

fn ftyp_payload() -> Vec<u8> {
    let mut v = Vec::new();
    v.extend_from_slice(b"isom");
    v.extend_from_slice(&0x0000_0200u32.to_be_bytes());
    v.extend_from_slice(b"isomiso2avc1mp41");
    v
}

fn video_trak(
    id: u32,
    cfg: &AvcConfig,
    samples: &[Sample],
    movie_timescale: u32,
    movie_duration: u32,
) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    out.extend(box_bytes(
        b"tkhd",
        &tkhd_payload(id, movie_duration, cfg.width, cfg.height, true),
    ));
    out.extend(box_bytes(
        b"mdia",
        &mdia_payload(
            b"vide",
            90_000,
            media_duration(samples, 3000) as u32,
            &video_minf(cfg, samples)?,
        ),
    ));
    out.extend(box_bytes(b"edts", &box_bytes(b"elst", &elst_payload(movie_timescale, movie_duration))));
    Ok(box_bytes(b"trak", &out))
}

fn audio_trak(
    id: u32,
    cfg: &AacConfig,
    samples: &[Sample],
    movie_timescale: u32,
    movie_duration: u32,
) -> Result<Vec<u8>, String> {
    let duration = samples.len() as u32 * 1024;
    let mut out = Vec::new();
    out.extend(box_bytes(b"tkhd", &tkhd_payload(id, movie_duration, 0, 0, false)));
    out.extend(box_bytes(
        b"mdia",
        &mdia_payload(b"soun", cfg.sample_rate, duration, &audio_minf(cfg, samples)?),
    ));
    out.extend(box_bytes(b"edts", &box_bytes(b"elst", &elst_payload(movie_timescale, movie_duration))));
    Ok(box_bytes(b"trak", &out))
}

fn mdia_payload(handler: &[u8; 4], timescale: u32, duration: u32, minf: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend(box_bytes(b"mdhd", &mdhd_payload(timescale, duration)));
    out.extend(box_bytes(b"hdlr", &hdlr_payload(handler)));
    out.extend_from_slice(minf);
    out
}

fn video_minf(cfg: &AvcConfig, samples: &[Sample]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    out.extend(box_bytes(b"vmhd", &vmhd_payload()));
    out.extend(dinf_box());
    out.extend(box_bytes(b"stbl", &stbl_payload(&stsd_video(cfg)?, samples, 3000, true)));
    Ok(box_bytes(b"minf", &out))
}

fn audio_minf(cfg: &AacConfig, samples: &[Sample]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    out.extend(box_bytes(b"smhd", &smhd_payload()));
    out.extend(dinf_box());
    out.extend(box_bytes(b"stbl", &stbl_payload(&stsd_audio(cfg), samples, 1024, false)));
    Ok(box_bytes(b"minf", &out))
}

fn stbl_payload(stsd: &[u8], samples: &[Sample], fallback_delta: u32, video: bool) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(stsd);
    out.extend(box_bytes(b"stts", &stts_payload(samples, fallback_delta)));
    if video && samples.iter().any(|s| s.cts_offset > 0) {
        out.extend(box_bytes(b"ctts", &ctts_payload(samples)));
    }
    if video {
        let stss = stss_payload(samples);
        if !stss.is_empty() {
            out.extend(box_bytes(b"stss", &stss));
        }
    }
    out.extend(box_bytes(b"stsc", &stsc_payload()));
    out.extend(box_bytes(b"stsz", &stsz_payload(samples)));
    out.extend(box_bytes(b"co64", &co64_payload(samples)));
    out
}

fn stsd_video(cfg: &AvcConfig) -> Result<Vec<u8>, String> {
    if cfg.sps.is_empty() || cfg.pps.is_empty() {
        return Err("missing h264 sps/pps".to_string());
    }
    let mut avc1 = Vec::new();
    avc1.extend_from_slice(&[0; 6]);
    avc1.extend_from_slice(&1u16.to_be_bytes());
    avc1.extend_from_slice(&[0; 16]);
    avc1.extend_from_slice(&cfg.width.to_be_bytes());
    avc1.extend_from_slice(&cfg.height.to_be_bytes());
    avc1.extend_from_slice(&0x0048_0000u32.to_be_bytes());
    avc1.extend_from_slice(&0x0048_0000u32.to_be_bytes());
    avc1.extend_from_slice(&0u32.to_be_bytes());
    avc1.extend_from_slice(&1u16.to_be_bytes());
    avc1.extend_from_slice(&[0; 32]);
    avc1.extend_from_slice(&0x0018u16.to_be_bytes());
    avc1.extend_from_slice(&0xffffu16.to_be_bytes());
    avc1.extend(box_bytes(b"avcC", &avcc_payload(cfg)));

    let mut out = fullbox(0, 0);
    out.extend_from_slice(&1u32.to_be_bytes());
    out.extend(box_bytes(b"avc1", &avc1));
    Ok(box_bytes(b"stsd", &out))
}

fn stsd_audio(cfg: &AacConfig) -> Vec<u8> {
    let mut mp4a = Vec::new();
    mp4a.extend_from_slice(&[0; 6]);
    mp4a.extend_from_slice(&1u16.to_be_bytes());
    mp4a.extend_from_slice(&[0; 8]);
    mp4a.extend_from_slice(&(cfg.channels as u16).to_be_bytes());
    mp4a.extend_from_slice(&16u16.to_be_bytes());
    mp4a.extend_from_slice(&0u16.to_be_bytes());
    mp4a.extend_from_slice(&0u16.to_be_bytes());
    mp4a.extend_from_slice(&(cfg.sample_rate << 16).to_be_bytes());
    mp4a.extend(box_bytes(b"esds", &esds_payload(cfg)));
    let mut out = fullbox(0, 0);
    out.extend_from_slice(&1u32.to_be_bytes());
    out.extend(box_bytes(b"mp4a", &mp4a));
    box_bytes(b"stsd", &out)
}

fn avcc_payload(cfg: &AvcConfig) -> Vec<u8> {
    let profile = *cfg.sps.get(1).unwrap_or(&0x64);
    let compat = *cfg.sps.get(2).unwrap_or(&0);
    let level = *cfg.sps.get(3).unwrap_or(&0x1f);
    let mut out = vec![1, profile, compat, level, 0xff, 0xe1];
    out.extend_from_slice(&(cfg.sps.len() as u16).to_be_bytes());
    out.extend_from_slice(&cfg.sps);
    out.push(1);
    out.extend_from_slice(&(cfg.pps.len() as u16).to_be_bytes());
    out.extend_from_slice(&cfg.pps);
    out
}

fn esds_payload(cfg: &AacConfig) -> Vec<u8> {
    let audio_object_type = cfg.profile + 1;
    let asc0 = (audio_object_type << 3) | (cfg.sample_rate_index >> 1);
    let asc1 = ((cfg.sample_rate_index & 1) << 7) | (cfg.channels << 3);
    let dsi = desc(0x05, &[asc0, asc1]);
    let mut dcd = vec![0x40, 0x15, 0, 0, 0];
    dcd.extend_from_slice(&0u32.to_be_bytes());
    dcd.extend_from_slice(&0u32.to_be_bytes());
    dcd.extend(dsi);
    let dcd = desc(0x04, &dcd);
    let mut es = Vec::new();
    es.extend_from_slice(&0u16.to_be_bytes());
    es.push(0);
    es.extend(dcd);
    es.extend(desc(0x06, &[2]));
    let mut out = fullbox(0, 0);
    out.extend(desc(0x03, &es));
    out
}

fn desc(tag: u8, payload: &[u8]) -> Vec<u8> {
    let mut out = vec![tag];
    let mut len = payload.len();
    let mut stack = [0u8; 4];
    let mut count = 0usize;
    stack[count] = (len & 0x7f) as u8;
    count += 1;
    len >>= 7;
    while len > 0 {
        stack[count] = ((len & 0x7f) as u8) | 0x80;
        count += 1;
        len >>= 7;
    }
    for b in stack[..count].iter().rev() {
        out.push(*b);
    }
    out.extend_from_slice(payload);
    out
}

fn mvhd_payload(timescale: u32, duration: u32) -> Vec<u8> {
    let mut out = fullbox(0, 0);
    out.extend_from_slice(&0u32.to_be_bytes());
    out.extend_from_slice(&0u32.to_be_bytes());
    out.extend_from_slice(&timescale.to_be_bytes());
    out.extend_from_slice(&duration.to_be_bytes());
    out.extend_from_slice(&0x0001_0000u32.to_be_bytes());
    out.extend_from_slice(&0x0100u16.to_be_bytes());
    out.extend_from_slice(&[0; 10]);
    out.extend_from_slice(&matrix_identity());
    out.extend_from_slice(&[0; 24]);
    out.extend_from_slice(&3u32.to_be_bytes());
    out
}

fn tkhd_payload(id: u32, duration: u32, width: u16, height: u16, video: bool) -> Vec<u8> {
    let mut out = fullbox(0, 0x000007);
    out.extend_from_slice(&0u32.to_be_bytes());
    out.extend_from_slice(&0u32.to_be_bytes());
    out.extend_from_slice(&id.to_be_bytes());
    out.extend_from_slice(&0u32.to_be_bytes());
    out.extend_from_slice(&duration.to_be_bytes());
    out.extend_from_slice(&[0; 8]);
    out.extend_from_slice(&0u16.to_be_bytes());
    out.extend_from_slice(&0u16.to_be_bytes());
    let volume = if video { 0u16 } else { 0x0100u16 };
    out.extend_from_slice(&volume.to_be_bytes());
    out.extend_from_slice(&0u16.to_be_bytes());
    out.extend_from_slice(&matrix_identity());
    out.extend_from_slice(&((width as u32) << 16).to_be_bytes());
    out.extend_from_slice(&((height as u32) << 16).to_be_bytes());
    out
}

fn mdhd_payload(timescale: u32, duration: u32) -> Vec<u8> {
    let mut out = fullbox(0, 0);
    out.extend_from_slice(&0u32.to_be_bytes());
    out.extend_from_slice(&0u32.to_be_bytes());
    out.extend_from_slice(&timescale.to_be_bytes());
    out.extend_from_slice(&duration.to_be_bytes());
    out.extend_from_slice(&0x55c4u16.to_be_bytes());
    out.extend_from_slice(&0u16.to_be_bytes());
    out
}

fn hdlr_payload(handler: &[u8; 4]) -> Vec<u8> {
    let mut out = fullbox(0, 0);
    out.extend_from_slice(&0u32.to_be_bytes());
    out.extend_from_slice(handler);
    out.extend_from_slice(&[0; 12]);
    out.push(0);
    out
}

fn vmhd_payload() -> Vec<u8> {
    let mut out = fullbox(0, 1);
    out.extend_from_slice(&[0; 8]);
    out
}

fn smhd_payload() -> Vec<u8> {
    let mut out = fullbox(0, 0);
    out.extend_from_slice(&0u16.to_be_bytes());
    out.extend_from_slice(&0u16.to_be_bytes());
    out
}

fn dinf_box() -> Vec<u8> {
    let url = fullbox(0, 1);
    let url = box_bytes(b"url ", &url);
    let mut dref = fullbox(0, 0);
    dref.extend_from_slice(&1u32.to_be_bytes());
    dref.extend(url);
    box_bytes(b"dinf", &box_bytes(b"dref", &dref))
}

fn elst_payload(movie_timescale: u32, duration: u32) -> Vec<u8> {
    let mut out = fullbox(0, 0);
    out.extend_from_slice(&1u32.to_be_bytes());
    out.extend_from_slice(&duration.to_be_bytes());
    out.extend_from_slice(&0u32.to_be_bytes());
    out.extend_from_slice(&0x0001_0000u32.to_be_bytes());
    let _ = movie_timescale;
    out
}

fn stts_payload(samples: &[Sample], fallback_delta: u32) -> Vec<u8> {
    let deltas = sample_durations(samples, fallback_delta);
    let mut runs: Vec<(u32, u32)> = Vec::new();
    for delta in deltas {
        if let Some(last) = runs.last_mut() {
            if last.1 == delta {
                last.0 += 1;
                continue;
            }
        }
        runs.push((1, delta));
    }
    let mut out = fullbox(0, 0);
    out.extend_from_slice(&(runs.len() as u32).to_be_bytes());
    for (count, delta) in runs {
        out.extend_from_slice(&count.to_be_bytes());
        out.extend_from_slice(&delta.to_be_bytes());
    }
    out
}

fn ctts_payload(samples: &[Sample]) -> Vec<u8> {
    let mut runs: Vec<(u32, u32)> = Vec::new();
    for s in samples {
        let offset = s.cts_offset.max(0) as u32;
        if let Some(last) = runs.last_mut() {
            if last.1 == offset {
                last.0 += 1;
                continue;
            }
        }
        runs.push((1, offset));
    }
    let mut out = fullbox(0, 0);
    out.extend_from_slice(&(runs.len() as u32).to_be_bytes());
    for (count, offset) in runs {
        out.extend_from_slice(&count.to_be_bytes());
        out.extend_from_slice(&offset.to_be_bytes());
    }
    out
}

fn stss_payload(samples: &[Sample]) -> Vec<u8> {
    let keys: Vec<u32> = samples
        .iter()
        .enumerate()
        .filter_map(|(i, s)| if s.key { Some(i as u32 + 1) } else { None })
        .collect();
    if keys.is_empty() {
        return Vec::new();
    }
    let mut out = fullbox(0, 0);
    out.extend_from_slice(&(keys.len() as u32).to_be_bytes());
    for key in keys {
        out.extend_from_slice(&key.to_be_bytes());
    }
    out
}

fn stsc_payload() -> Vec<u8> {
    let mut out = fullbox(0, 0);
    out.extend_from_slice(&1u32.to_be_bytes());
    out.extend_from_slice(&1u32.to_be_bytes());
    out.extend_from_slice(&1u32.to_be_bytes());
    out.extend_from_slice(&1u32.to_be_bytes());
    out
}

fn stsz_payload(samples: &[Sample]) -> Vec<u8> {
    let mut out = fullbox(0, 0);
    out.extend_from_slice(&0u32.to_be_bytes());
    out.extend_from_slice(&(samples.len() as u32).to_be_bytes());
    for s in samples {
        out.extend_from_slice(&s.size.to_be_bytes());
    }
    out
}

fn co64_payload(samples: &[Sample]) -> Vec<u8> {
    let mut out = fullbox(0, 0);
    out.extend_from_slice(&(samples.len() as u32).to_be_bytes());
    for s in samples {
        out.extend_from_slice(&s.offset.to_be_bytes());
    }
    out
}

fn fullbox(version: u8, flags: u32) -> Vec<u8> {
    vec![
        version,
        ((flags >> 16) & 0xff) as u8,
        ((flags >> 8) & 0xff) as u8,
        (flags & 0xff) as u8,
    ]
}

fn box_bytes(typ: &[u8; 4], payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(payload.len() + 8);
    out.extend_from_slice(&((payload.len() + 8) as u32).to_be_bytes());
    out.extend_from_slice(typ);
    out.extend_from_slice(payload);
    out
}

fn matrix_identity() -> [u8; 36] {
    [
        0x00, 0x01, 0x00, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x00, 0x01, 0x00, 0x00, 0,
        0, 0, 0, 0, 0, 0, 0, 0x40, 0, 0, 0, 0, 0, 0, 0,
    ]
}

fn parse_sps_dimensions(sps: &[u8]) -> Option<(u16, u16)> {
    if sps.len() < 4 {
        return None;
    }
    let rbsp = remove_emulation_prevention(&sps[1..]);
    let mut br = BitReader::new(&rbsp);
    let profile = br.read_bits(8)? as u8;
    br.read_bits(8)?;
    br.read_bits(8)?;
    br.read_ue()?;
    if matches!(
        profile,
        100 | 110 | 122 | 244 | 44 | 83 | 86 | 118 | 128 | 138 | 139 | 134
    ) {
        let chroma_format_idc = br.read_ue()?;
        if chroma_format_idc == 3 {
            br.read_bit()?;
        }
        br.read_ue()?;
        br.read_ue()?;
        br.read_bit()?;
        if br.read_bit()? != 0 {
            for i in 0..8 {
                if br.read_bit()? != 0 {
                    skip_scaling_list(&mut br, if i < 6 { 16 } else { 64 })?;
                }
            }
        }
    }
    br.read_ue()?;
    let pic_order_cnt_type = br.read_ue()?;
    if pic_order_cnt_type == 0 {
        br.read_ue()?;
    } else if pic_order_cnt_type == 1 {
        br.read_bit()?;
        br.read_se()?;
        br.read_se()?;
        let n = br.read_ue()?;
        for _ in 0..n {
            br.read_se()?;
        }
    }
    br.read_ue()?;
    br.read_bit()?;
    let pic_width_in_mbs_minus1 = br.read_ue()?;
    let pic_height_in_map_units_minus1 = br.read_ue()?;
    let frame_mbs_only_flag = br.read_bit()?;
    if frame_mbs_only_flag == 0 {
        br.read_bit()?;
    }
    br.read_bit()?;
    let mut crop_left = 0;
    let mut crop_right = 0;
    let mut crop_top = 0;
    let mut crop_bottom = 0;
    if br.read_bit()? != 0 {
        crop_left = br.read_ue()?;
        crop_right = br.read_ue()?;
        crop_top = br.read_ue()?;
        crop_bottom = br.read_ue()?;
    }
    let width = ((pic_width_in_mbs_minus1 + 1) * 16).saturating_sub((crop_left + crop_right) * 2);
    let height = ((2 - frame_mbs_only_flag) * (pic_height_in_map_units_minus1 + 1) * 16)
        .saturating_sub((crop_top + crop_bottom) * 2);
    Some((width as u16, height as u16))
}

fn remove_emulation_prevention(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len());
    let mut i = 0usize;
    while i < data.len() {
        if i + 2 < data.len() && data[i] == 0 && data[i + 1] == 0 && data[i + 2] == 3 {
            out.push(0);
            out.push(0);
            i += 3;
        } else {
            out.push(data[i]);
            i += 1;
        }
    }
    out
}

fn skip_scaling_list(br: &mut BitReader<'_>, size: usize) -> Option<()> {
    let mut last_scale = 8i32;
    let mut next_scale = 8i32;
    for _ in 0..size {
        if next_scale != 0 {
            let delta = br.read_se()?;
            next_scale = (last_scale + delta + 256) % 256;
        }
        last_scale = if next_scale == 0 { last_scale } else { next_scale };
    }
    Some(())
}

struct BitReader<'a> {
    data: &'a [u8],
    bit: usize,
}

impl<'a> BitReader<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, bit: 0 }
    }

    fn read_bit(&mut self) -> Option<u32> {
        if self.bit >= self.data.len() * 8 {
            return None;
        }
        let b = self.data[self.bit / 8];
        let v = (b >> (7 - (self.bit % 8))) & 1;
        self.bit += 1;
        Some(v as u32)
    }

    fn read_bits(&mut self, n: usize) -> Option<u32> {
        let mut v = 0;
        for _ in 0..n {
            v = (v << 1) | self.read_bit()?;
        }
        Some(v)
    }

    fn read_ue(&mut self) -> Option<u32> {
        let mut zeros = 0;
        while self.read_bit()? == 0 {
            zeros += 1;
            if zeros > 31 {
                return None;
            }
        }
        let suffix = if zeros > 0 { self.read_bits(zeros)? } else { 0 };
        Some((1u32 << zeros) - 1 + suffix)
    }

    fn read_se(&mut self) -> Option<i32> {
        let v = self.read_ue()? as i32;
        Some(if v & 1 == 0 { -(v / 2) } else { (v + 1) / 2 })
    }
}
