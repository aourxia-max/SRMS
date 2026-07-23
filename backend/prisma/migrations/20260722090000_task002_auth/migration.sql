-- Task002 authentication baseline: user identities, refresh-token sessions and preferences.
CREATE TABLE `users` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username` VARCHAR(50) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `display_name` VARCHAR(50) NOT NULL,
  `role` ENUM('SUPER_ADMIN', 'ADMIN', 'VISITOR') NOT NULL,
  `phone` VARCHAR(30) NULL,
  `status` ENUM('ACTIVE', 'DISABLED', 'LOCKED') NOT NULL DEFAULT 'ACTIVE',
  `failed_login_count` INT NOT NULL DEFAULT 0,
  `locked_until` DATETIME(3) NULL,
  `last_login_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_by` INT UNSIGNED NULL,
  `updated_at` DATETIME(3) NOT NULL,
  `updated_by` INT UNSIGNED NULL,
  `deleted_at` DATETIME(3) NULL,
  `deleted_by` INT UNSIGNED NULL,
  `version` INT NOT NULL DEFAULT 1,
  UNIQUE INDEX `users_username_key`(`username`),
  INDEX `users_role_status_idx`(`role`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci ENGINE=InnoDB;

CREATE TABLE `auth_refresh_tokens` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `token_hash` VARCHAR(255) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `revoked_at` DATETIME(3) NULL,
  `ip_address` VARCHAR(45) NULL,
  `user_agent` VARCHAR(500) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `auth_refresh_tokens_user_id_expires_at_idx`(`user_id`, `expires_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `auth_refresh_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci ENGINE=InnoDB;

CREATE TABLE `user_preferences` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `dashboard_building_id` INT UNSIGNED NULL,
  `dashboard_room_statuses` JSON NULL,
  `dashboard_month_mode` VARCHAR(20) NOT NULL DEFAULT 'CURRENT_MONTH',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `user_preferences_user_id_key`(`user_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `user_preferences_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci ENGINE=InnoDB;
