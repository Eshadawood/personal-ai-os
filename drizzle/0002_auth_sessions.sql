-- Authentication upgrade for the existing Personal AI OS MVP.
-- Apply after 0001_sleepy_morph.sql (or run the equivalent ALTER/CREATE statements manually).
ALTER TABLE `users` ADD COLUMN `passwordHash` text NULL;
ALTER TABLE `users` MODIFY COLUMN `openId` varchar(128) NOT NULL;
CREATE TABLE `sessions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `tokenHash` varchar(128) NOT NULL,
  `expiresAt` timestamp NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `sessions_id` PRIMARY KEY(`id`),
  CONSTRAINT `sessions_tokenHash_unique` UNIQUE(`tokenHash`)
);
CREATE INDEX `sessions_userId_idx` ON `sessions` (`userId`);
CREATE INDEX `sessions_expiresAt_idx` ON `sessions` (`expiresAt`);
