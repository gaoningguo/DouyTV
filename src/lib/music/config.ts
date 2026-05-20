/**
 * 兼容垫层 —— 旧代码 `import { hasMusicBackend } from "@/lib/music/config"` 仍可工作。
 * 新 dispatcher 在 `@/lib/music/api`。
 */
export { hasMusicBackend, getActiveBackendInfo } from "./api";
