-- Phase 4: a quotation can be Cancelled (in addition to Rejected = lost, Expired, Superseded).
ALTER TABLE commercial_quotations DROP CONSTRAINT commercial_quotations_status_check;
ALTER TABLE commercial_quotations ADD CONSTRAINT commercial_quotations_status_check CHECK (status IN (
  'Draft', 'Internal Review', 'Submitted', 'Negotiation', 'Accepted', 'Rejected', 'Expired', 'Superseded', 'Cancelled'));
