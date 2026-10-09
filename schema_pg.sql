-- JOB-OPS PostgreSQL Database Schema
-- Compatible with PostgreSQL 12+ (tested on PostgreSQL 18)

-- ============================================================================
-- 1. Experience Levels
-- ============================================================================
CREATE TABLE IF NOT EXISTS experience_levels (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(50) NOT NULL UNIQUE,
  label VARCHAR(100) NOT NULL,
  min_years INT NOT NULL DEFAULT 0,
  max_years INT DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO experience_levels (slug, label, min_years, max_years)
VALUES
  ('fresher', 'Fresher / Entry Level (0-1 yrs)', 0, 1),
  ('junior', 'Junior Developer (1-3 yrs)', 1, 3),
  ('mid', 'Mid-Level Engineer (3-5 yrs)', 3, 5),
  ('senior', 'Senior Engineer (5-8 yrs)', 5, 8),
  ('lead', 'Lead / Staff Engineer (8+ yrs)', 8, NULL)
ON CONFLICT (slug) DO UPDATE
SET
  label = EXCLUDED.label,
  min_years = EXCLUDED.min_years,
  max_years = EXCLUDED.max_years;

-- ============================================================================
-- 2. Users
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  experience_level_id INT NULL REFERENCES experience_levels(id) ON DELETE SET NULL,
  gemini_api_key TEXT NULL,
  gemini_model VARCHAR(100) DEFAULT 'gemini-2.5-flash',
  expected_ctc_min NUMERIC NULL,
  expected_ctc_max NUMERIC NULL,
  token_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 3. User Target Roles
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_target_roles (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_name VARCHAR(255) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_user_target_roles_user_id ON user_target_roles(user_id);

-- ============================================================================
-- 4. User Target Locations
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_target_locations (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  location_name VARCHAR(255) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_user_target_locations_user_id ON user_target_locations(user_id);

-- ============================================================================
-- 5. User CVs
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_cvs (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version INT NOT NULL DEFAULT 1,
  content_md TEXT NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_user_cvs_user_current ON user_cvs(user_id, is_current);

-- ============================================================================
-- 6. Companies
-- ============================================================================
CREATE TABLE IF NOT EXISTS companies (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  slug VARCHAR(255) NULL,
  type VARCHAR(50) NOT NULL DEFAULT 'careers_page',
  url VARCHAR(1024) NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_companies_type ON companies(type);

INSERT INTO companies (name, slug, type, url)
VALUES
  ('Razorpay', 'razorpaysoftwareprivatelimited', 'greenhouse', NULL),
  ('PhonePe', 'phonepe', 'greenhouse', NULL),
  ('Groww', 'groww', 'greenhouse', NULL),
  ('BrowserStack', 'browserstack', 'greenhouse', NULL),
  ('Freshworks', 'freshworks', 'greenhouse', NULL),
  ('Postman', 'postman', 'greenhouse', NULL),
  ('Anthropic', 'anthropic', 'greenhouse', NULL),
  ('Cohere', 'cohere', 'greenhouse', NULL),
  ('Glean', 'glean', 'greenhouse', NULL),
  ('Retool', 'retool', 'greenhouse', NULL),
  ('Vercel', 'vercel', 'greenhouse', NULL),
  ('Figma', 'figma', 'greenhouse', NULL),
  ('Notion', 'notion', 'greenhouse', NULL),
  ('Rippling', 'rippling', 'greenhouse', NULL),
  ('Databricks', 'databricks', 'greenhouse', NULL),
  ('Arize AI', 'arize', 'greenhouse', NULL),
  ('Scale AI', 'scaleai', 'lever', NULL),
  ('Browserbase', 'browserbase', 'lever', NULL),
  ('Langfuse', 'langfuse', 'lever', NULL),
  ('PolyAI', 'polyai', 'lever', NULL),
  ('Vapi', 'vapi', 'lever', NULL),
  ('n8n', 'n8n', 'lever', NULL),
  ('Lindy', 'lindy', 'lever', NULL),
  ('Meesho', NULL, 'careers_page', 'https://www.meesho.io/jobs'),
  ('CRED', NULL, 'careers_page', 'https://careers.cred.club'),
  ('Zomato', NULL, 'careers_page', 'https://www.zomato.com/careers'),
  ('Swiggy', NULL, 'careers_page', 'https://careers.swiggy.com'),
  ('ElevenLabs', NULL, 'careers_page', 'https://jobs.ashbyhq.com/elevenlabs'),
  ('Hugging Face', NULL, 'careers_page', 'https://huggingface.co/jobs'),
  ('Linear', NULL, 'careers_page', 'https://linear.app/careers'),
  ('Mistral AI', NULL, 'careers_page', 'https://mistral.ai/careers'),
  ('Weights & Biases', NULL, 'careers_page', 'https://wandb.ai/careers'),
  ('Zepto', NULL, 'careers_page', 'https://www.zeptonow.com/careers'),
  ('Urban Company', NULL, 'careers_page', 'https://www.urbancompany.com/careers'),
  ('OpenAI', NULL, 'careers_page', 'https://openai.com/careers')
ON CONFLICT (name) DO UPDATE
SET
  slug = EXCLUDED.slug,
  type = EXCLUDED.type,
  url = EXCLUDED.url;

-- ============================================================================
-- 7. Scan Sessions
-- ============================================================================
CREATE TABLE IF NOT EXISTS scan_sessions (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(50) NOT NULL DEFAULT 'completed',
  sources_used TEXT NULL,
  keywords_used TEXT NULL,
  total_found INT NOT NULL DEFAULT 0,
  new_found INT NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_scan_sessions_user ON scan_sessions(user_id);

-- ============================================================================
-- 8. Scanned Jobs
-- ============================================================================
CREATE TABLE IF NOT EXISTS scanned_jobs (
  id SERIAL PRIMARY KEY,
  scan_session_id INT NULL REFERENCES scan_sessions(id) ON DELETE SET NULL,
  company_id INT NULL REFERENCES companies(id) ON DELETE SET NULL,
  company_name VARCHAR(255) NOT NULL,
  role_title VARCHAR(255) NOT NULL,
  location VARCHAR(255) NULL,
  job_url VARCHAR(1024) NOT NULL,
  source VARCHAR(100) NOT NULL DEFAULT 'manual',
  posted_at TIMESTAMPTZ NULL,
  is_evaluated BOOLEAN NOT NULL DEFAULT FALSE,
  is_duplicate BOOLEAN NOT NULL DEFAULT FALSE,
  raw_data JSONB NULL,
  scraped_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_scanned_jobs_session ON scanned_jobs(scan_session_id);
CREATE INDEX IF NOT EXISTS idx_scanned_jobs_url ON scanned_jobs(job_url);
CREATE INDEX IF NOT EXISTS idx_scanned_jobs_evaluated ON scanned_jobs(is_evaluated);

-- ============================================================================
-- 9. Applications
-- ============================================================================
CREATE TABLE IF NOT EXISTS applications (
  id VARCHAR(64) PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scanned_job_id INT NULL REFERENCES scanned_jobs(id) ON DELETE SET NULL,
  company_id INT NULL REFERENCES companies(id) ON DELETE SET NULL,
  company_name VARCHAR(255) NOT NULL,
  role_title VARCHAR(255) NOT NULL,
  location VARCHAR(255) NULL,
  job_url VARCHAR(1024) NOT NULL,
  job_description TEXT NULL,
  source VARCHAR(100) NOT NULL DEFAULT 'manual',
  ai_score NUMERIC(3,1) NULL,
  ai_grade VARCHAR(5) NULL,
  verdict VARCHAR(255) NULL,
  fit_summary TEXT NULL,
  negotiation_note TEXT NULL,
  salary_estimate VARCHAR(255) NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'evaluated',
  experience_level_id INT NULL REFERENCES experience_levels(id) ON DELETE SET NULL,
  required_exp_min INT NULL DEFAULT NULL,
  required_exp_max INT NULL DEFAULT NULL,
  evaluated_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_applications_user ON applications(user_id);
CREATE INDEX IF NOT EXISTS idx_applications_user_url ON applications(user_id, job_url);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_evaluated ON applications(evaluated_at);

-- ============================================================================
-- 10. Application Strengths
-- ============================================================================
CREATE TABLE IF NOT EXISTS application_strengths (
  id SERIAL PRIMARY KEY,
  application_id VARCHAR(64) NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  strength TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_app_strengths_application ON application_strengths(application_id);

-- ============================================================================
-- 11. Application Gaps
-- ============================================================================
CREATE TABLE IF NOT EXISTS application_gaps (
  id SERIAL PRIMARY KEY,
  application_id VARCHAR(64) NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  gap TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_app_gaps_application ON application_gaps(application_id);

-- ============================================================================
-- 12. Application Interview Prep
-- ============================================================================
CREATE TABLE IF NOT EXISTS application_interview_prep (
  id SERIAL PRIMARY KEY,
  application_id VARCHAR(64) NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_app_interview_application ON application_interview_prep(application_id);

-- ============================================================================
-- 13. Application Action Items
-- ============================================================================
CREATE TABLE IF NOT EXISTS application_action_items (
  id SERIAL PRIMARY KEY,
  application_id VARCHAR(64) NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  action_item TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_app_action_application ON application_action_items(application_id);

-- ============================================================================
-- 14. Resumes
-- ============================================================================
CREATE TABLE IF NOT EXISTS resumes (
  id SERIAL PRIMARY KEY,
  application_id VARCHAR(64) NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version INT NOT NULL DEFAULT 1,
  html_path VARCHAR(1024) NULL,
  pdf_path VARCHAR(1024) NULL,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  generated_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_resumes_application ON resumes(application_id, is_current);
CREATE INDEX IF NOT EXISTS idx_resumes_user ON resumes(user_id);

-- ============================================================================
-- 15. Activity Log
-- ============================================================================
CREATE TABLE IF NOT EXISTS activity_log (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100) NULL,
  entity_id VARCHAR(255) NULL,
  meta JSONB NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_activity_log_user_date ON activity_log(user_id, created_at);
