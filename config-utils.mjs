/**
 * JOB-OPS Configuration & Utility Module
 * Modular facade re-exporting partitioned services for configuration, storage,
 * validation, usage tracking, and experience heuristics.
 */

// 1. Paths and constants
export {
  REPO_ROOT,
  JOB_OPS_DATA_DIR,
  APPLICATIONS_FILE,
  USAGE_FILE,
  BREAKER_FILE,
  SCAN_RESULTS_FILE,
  HEALTH_LOG_FILE,
  CV_FILE,
  GEMINI_QUOTA_TIME_ZONE,
  getDataDir,
  getDataFilePath,
  getConfigPaths,
  getPlaceholderApiKey,
} from "./src/config/configPaths.mjs";

// 2. File Locking and atomic operations
export {
  syncSleep,
  sleep,
  sanitizeFileStem,
  loadJsonFile,
  withFileLock,
  withFileLockSync,
  writeJsonFileAtomic,
} from "./src/utils/fileLock.mjs";

// 3. Configuration and environment loader
export {
  loadEnvFiles,
  saveEnvUpdates,
  loadConfig,
  loadCV,
  loadCVWithCache,
  isPlaceholderCv,
} from "./src/config/configService.mjs";

// 4. Quota and usage tracking
export {
  readBreakerState,
  writeBreakerState,
  readGeminiUsage,
  getGeminiUsageDay,
  getGeminiUsageStats,
  getGeminiUsageCount,
  trackGeminiCall,
  backupIfNeeded,
} from "./src/services/usageTracker.mjs";

// 5. Evaluation validation and scoring
export {
  DEFAULT_GRADE_THRESHOLDS,
  gradeFromScore,
  validateEvaluation,
  isRetryableGeminiError,
  getRetryAfterMs,
  withRetry,
} from "./src/services/evaluationValidator.mjs";

// 6. Experience parsing and candidate fit
export {
  getExperienceProfile,
  extractRelevantExperienceText,
  extractUrlSlugText,
  extractMinYears,
  buildExperienceContext,
  assessExperienceFit,
} from "./src/services/experienceService.mjs";

// 7. Applications storage and identity
export {
  buildApplicationKey,
  buildApplicationIdentitySet,
  applicationsMatch,
  generateApplicationId,
  loadApplications,
  saveApplications,
  upsertApplication,
} from "./src/services/applicationService.mjs";

export { canonicalizeUrl, jobKey, softKey, isSameJob } from "./jobIdentity.mjs";

