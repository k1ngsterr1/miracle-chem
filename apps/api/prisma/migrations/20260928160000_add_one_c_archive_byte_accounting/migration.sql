ALTER TABLE "one_c_archive_imports" ADD COLUMN "encryptedBytes" BIGINT NOT NULL DEFAULT 0;

UPDATE "one_c_archive_imports" AS archive
SET "encryptedBytes" = COALESCE((
  SELECT SUM(OCTET_LENGTH(chunk."encryptedData"))
  FROM "one_c_archive_chunks" AS chunk
  WHERE chunk."importId" = archive."id"
), 0);

ALTER TABLE "one_c_archive_imports"
ADD CONSTRAINT "one_c_archive_imports_encryptedBytes_check"
CHECK ("encryptedBytes" >= 0 AND "encryptedBytes" <= 2147483648);
