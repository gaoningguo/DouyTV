import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import ErrorBoundary from "@/components/ErrorBoundary";
import { initStreamProxyPort } from "@/lib/proxy";
import "./styles.css";

// 在 Tauri 环境下提前 fetch 本地 hyper 流代理端口（FLV 直播必备）
// fire-and-forget — wrapWithProxy 有 fallback 不会 block 启动
void initStreamProxyPort();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
