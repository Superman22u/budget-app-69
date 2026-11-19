CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'user',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS password_resets (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  KEY idx_reset_user (user_id),
  CONSTRAINT fk_reset_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS categories (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  name VARCHAR(80) NOT NULL,
  kind VARCHAR(20) NOT NULL,
  UNIQUE KEY uq_category (user_id, kind, name),
  CONSTRAINT fk_category_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS category_rules (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  pattern VARCHAR(200) NOT NULL,
  category VARCHAR(80) NOT NULL,
  priority INT NOT NULL DEFAULT 10,
  UNIQUE KEY uq_rule (user_id, pattern),
  CONSTRAINT fk_rule_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS family_members (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  name VARCHAR(120) NOT NULL,
  UNIQUE KEY uq_family (user_id, name),
  CONSTRAINT fk_family_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS exchange_rates (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  currency CHAR(3) NOT NULL,
  rate_to_chf DECIMAL(18,8) NOT NULL,
  as_of DATE NOT NULL,
  UNIQUE KEY uq_rate (user_id, currency, as_of),
  CONSTRAINT fk_rate_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS budget_entries (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  first_pay_date DATE NOT NULL,
  frequency VARCHAR(20) NOT NULL,
  occurrence_count INT NULL,
  until_date DATE NULL,
  description VARCHAR(500) NOT NULL,
  contact_name VARCHAR(255) NULL,
  direction VARCHAR(10) NOT NULL DEFAULT 'expense',
  amount DECIMAL(14,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'CHF',
  exchange_rate DECIMAL(18,8) NULL,
  chf_amount DECIMAL(14,2) NOT NULL,
  family_member VARCHAR(120) NULL,
  category VARCHAR(80) NULL,
  inflation_percent DECIMAL(8,3) NOT NULL DEFAULT 0,
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_budget_user (user_id, first_pay_date),
  CONSTRAINT fk_budget_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS budget_plans (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  title VARCHAR(200) NOT NULL,
  start_date DATE NOT NULL,
  days INT NOT NULL,
  start_amount DECIMAL(14,2) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_plan_user (user_id, created_at),
  CONSTRAINT fk_plan_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS budget_plan_lines (
  id CHAR(36) PRIMARY KEY,
  plan_id CHAR(36) NOT NULL,
  budget_entry_id CHAR(36) NULL,
  due_date DATE NOT NULL,
  description VARCHAR(500) NOT NULL,
  contact_name VARCHAR(255) NULL,
  direction VARCHAR(10) NOT NULL,
  currency CHAR(3) NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  exchange_rate DECIMAL(18,8) NULL,
  chf_amount DECIMAL(14,2) NOT NULL,
  actual_chf DECIMAL(14,2) NULL,
  family_member VARCHAR(120) NULL,
  category VARCHAR(80) NULL,
  KEY idx_line_plan (plan_id, due_date),
  CONSTRAINT fk_line_plan FOREIGN KEY (plan_id) REFERENCES budget_plans(id) ON DELETE CASCADE,
  CONSTRAINT fk_line_entry FOREIGN KEY (budget_entry_id) REFERENCES budget_entries(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS import_batches (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  file_name VARCHAR(500) NOT NULL,
  source_kind VARCHAR(20) NOT NULL,
  provider VARCHAR(80) NULL,
  imported_count INT NOT NULL DEFAULT 0,
  skipped_count INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_batch_user (user_id, created_at),
  CONSTRAINT fk_batch_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS transactions (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  source_kind VARCHAR(20) NOT NULL,
  provider VARCHAR(80) NOT NULL,
  account_ref VARCHAR(120) NULL,
  card_ref VARCHAR(80) NULL,
  booking_date DATE NOT NULL,
  value_date DATE NULL,
  booked_at DATETIME NOT NULL,
  description VARCHAR(1000) NOT NULL,
  details TEXT NULL,
  merchant VARCHAR(255) NULL,
  currency CHAR(3) NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  chf_amount DECIMAL(14,2) NULL,
  exchange_rate DECIMAL(18,8) NULL,
  direction VARCHAR(10) NOT NULL,
  balance DECIMAL(14,2) NULL,
  external_id VARCHAR(120) NULL,
  category VARCHAR(80) NULL,
  import_batch_id CHAR(36) NULL,
  import_file VARCHAR(500) NULL,
  raw_json LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tx_ext (user_id, provider, external_id),
  KEY idx_tx_date (user_id, booking_date),
  KEY idx_tx_dedupe (user_id, provider, booking_date, amount, currency),
  CONSTRAINT fk_tx_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_tx_batch FOREIGN KEY (import_batch_id) REFERENCES import_batches(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS budget_links (
  id CHAR(36) PRIMARY KEY,
  plan_id CHAR(36) NOT NULL,
  plan_line_id CHAR(36) NOT NULL,
  transaction_id CHAR(36) NOT NULL,
  source VARCHAR(10) NOT NULL,
  UNIQUE KEY uq_plan_tx (plan_id, transaction_id),
  UNIQUE KEY uq_line_tx (plan_line_id, transaction_id),
  CONSTRAINT fk_link_plan FOREIGN KEY (plan_id) REFERENCES budget_plans(id) ON DELETE CASCADE,
  CONSTRAINT fk_link_line FOREIGN KEY (plan_line_id) REFERENCES budget_plan_lines(id) ON DELETE CASCADE,
  CONSTRAINT fk_link_tx FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS healthcare_documents (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  doc_type VARCHAR(40) NOT NULL,
  reference_no VARCHAR(80) NULL,
  insured_name VARCHAR(200) NULL,
  insured_number VARCHAR(40) NULL,
  document_date DATE NULL,
  service_date DATE NULL,
  provider_name VARCHAR(255) NULL,
  description VARCHAR(1000) NULL,
  invoice_amount DECIMAL(14,2) NULL,
  patient_share DECIMAL(14,2) NULL,
  insurer_share DECIMAL(14,2) NULL,
  currency CHAR(3) NOT NULL DEFAULT 'CHF',
  payout_iban VARCHAR(64) NULL,
  file_name VARCHAR(500) NULL,
  stored_path VARCHAR(500) NULL,
  transaction_id CHAR(36) NULL,
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_health_user (user_id, document_date),
  CONSTRAINT fk_health_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_health_tx FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS receipts (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  store_name VARCHAR(200) NULL,
  store_chain VARCHAR(80) NULL,
  purchased_at DATETIME NULL,
  total_amount DECIMAL(14,2) NULL,
  currency CHAR(3) NOT NULL DEFAULT 'CHF',
  payment_method VARCHAR(80) NULL,
  card_hint VARCHAR(40) NULL,
  file_name VARCHAR(500) NULL,
  stored_path VARCHAR(500) NULL,
  transaction_id CHAR(36) NULL,
  raw_text MEDIUMTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_receipt_user (user_id, purchased_at),
  CONSTRAINT fk_receipt_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_receipt_tx FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS receipt_items (
  id CHAR(36) PRIMARY KEY,
  receipt_id CHAR(36) NOT NULL,
  description VARCHAR(300) NOT NULL,
  quantity DECIMAL(12,3) NULL,
  weight DECIMAL(12,3) NULL,
  unit_price DECIMAL(14,2) NULL,
  line_total DECIMAL(14,2) NULL,
  expiry_date DATE NULL,
  sort_order INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_item_receipt FOREIGN KEY (receipt_id) REFERENCES receipts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
