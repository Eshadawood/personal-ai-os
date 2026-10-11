CREATE TABLE `calendarEvents` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `title` text NOT NULL,
  `description` text,
  `startsAt` timestamp NOT NULL,
  `endsAt` timestamp NULL,
  `allDay` int NOT NULL DEFAULT 0,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), KEY `calendarEvents_userId_startsAt_idx` (`userId`, `startsAt`)
);
CREATE TABLE `reminders` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `title` text NOT NULL,
  `dueAt` timestamp NOT NULL,
  `recurrence` enum('none','daily','weekly','monthly') NOT NULL DEFAULT 'none',
  `completedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), KEY `reminders_userId_dueAt_idx` (`userId`, `dueAt`)
);
CREATE TABLE `documents` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `filename` varchar(255) NOT NULL,
  `mimeType` varchar(120) NOT NULL,
  `content` mediumtext NOT NULL,
  `summary` text,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), KEY `documents_userId_idx` (`userId`)
);
CREATE TABLE `sentEmails` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `recipient` varchar(320) NOT NULL,
  `subject` text NOT NULL,
  `body` text NOT NULL,
  `providerId` varchar(255),
  `status` enum('sent','failed') NOT NULL,
  `error` text,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), KEY `sentEmails_userId_createdAt_idx` (`userId`, `createdAt`)
);

CREATE TABLE `productivitySummaries` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `weekOf` timestamp NOT NULL,
  `summary` text NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), KEY `productivitySummaries_userId_weekOf_idx` (`userId`, `weekOf`)
);
