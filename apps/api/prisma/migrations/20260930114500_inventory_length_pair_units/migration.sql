-- Preserve 1C inventory dimensions; no existing quantities or units are rewritten.
ALTER TYPE "Unit" ADD VALUE 'M';
ALTER TYPE "Unit" ADD VALUE 'PAIR';
