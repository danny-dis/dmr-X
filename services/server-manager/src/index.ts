export {
  serverManager,
  createServerManager,
  detectRuntime,
  killTree,
  getGodmodeRepoInfo,
  getInstalledGodmodeRef,
  buildGodmodeNativeEnv,
  ServerManagerService,
} from './server-manager.service.js';
export type {
  ServerStatus,
  ServerRuntime,
  ServerInstance,
  StartOptions,
  BuildGodmodeNativeEnvOptions,
} from './server-manager.service.js';
export { applyGodmodePatches } from './patch-godmode.js';
export type { GodmodePatchResult } from './patch-godmode.js';
