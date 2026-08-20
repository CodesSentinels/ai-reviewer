/**
 * platform/gitlab-write-marker.ts — 兼容 shim
 *
 * 实现已泛化到 `write-marker.ts` 供两个平台共用（STATE-015）。本文件保留原路径，
 * §6 接线与 GLAPI-027 的既有测试不受影响。
 */
export * from './write-marker'
