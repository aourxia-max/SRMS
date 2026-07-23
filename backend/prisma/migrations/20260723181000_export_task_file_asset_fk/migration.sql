ALTER TABLE `export_tasks`
  ADD CONSTRAINT `fk_export_tasks_file_asset`
  FOREIGN KEY (`file_asset_id`) REFERENCES `file_assets`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
