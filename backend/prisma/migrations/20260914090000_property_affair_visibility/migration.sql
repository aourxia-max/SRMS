ALTER TABLE `property_affairs`
  ADD COLUMN `visibility_scope` ENUM('ALL','RESTRICTED') NOT NULL DEFAULT 'ALL';

CREATE TABLE `property_affair_viewers` (
  `affair_id` INT UNSIGNED NOT NULL,
  `user_id` INT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`affair_id`, `user_id`),
  KEY `property_affair_viewers_user_id_affair_id_idx` (`user_id`, `affair_id`),
  CONSTRAINT `property_affair_viewers_affair_id_fkey`
    FOREIGN KEY (`affair_id`) REFERENCES `property_affairs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `property_affair_viewers_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;