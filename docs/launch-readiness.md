# NW Concept Sdn Bhd launch gates

Keep real projects on the existing operating process until the owner signs off the gates below. Record the release SHA, operator, timestamp, and evidence for each decision. Run write tests in a separate synthetic environment.

## Infrastructure and recovery

- Confirm the live application database by matching the service's internal database target and runtime role in the Render dashboard. Record resource IDs and role names only.
- Before onboarding, move off any expiring database. Agree a recovery point and recovery time with the Owner. A starting target for a controlled pilot is at most one business day of lost changes and four hours to recover, subject to Owner approval.
- Use a restricted runtime login and separate migration and backup credentials. Confirm that the runtime can neither create schema objects nor update/delete audit history. Limit external database ingress to approved operators, or use private access only. Verify the web readiness probe and alert recipient.
- Set up durable encrypted backups with retention and an off-service copy. Include uploaded files and required encryption keys/configuration in the inventory. Review the actual successful backup and timestamp. Restore a recent copy into an isolated destination, check application sign-in, project/approval/audit data, attachment retrieval and grants, and record actual recovery duration. Keep access restricted and follow the applicable retention policy for the restored copy.
- Rehearse a cutover and rollback in staging. Before a release, record the last healthy deployed commit, check migration compatibility, take a verified recovery point and name the person authorized to stop writes. An application rollback can use the previous healthy deploy only if its schema is compatible. For data loss or corruption, stop writes, preserve the incident state, restore into a new database, reconcile writes since the recovery point, verify the restored app, and obtain approval before pointing production at it.

## People and operating procedures

- Owner approves named accounts and project assignments. Admin handles records and onboarding. Project managers and site supervisors receive only their projects. Give contractors, clients, purchasing and finance roles only to named people with those duties. Confirm every invite with its recipient, require individual credentials and revoke departed users promptly.
- Before a first live project, walk each participant through login, finding assigned work, reporting a problem, and escalation. Confirm the project lead and backup, support channel, decision authority, and who checks the audit history.
- Use one controlled project with a daily reconciliation. Record the opening baseline, reconcile approvals, production, QC, deliveries and handovers daily, and pause expansion on missing records, duplicate writes, or an access incident. If a save is unconfirmed, keep the original entry and verify server state before re-entering it.
- Acceptance on real equipment: validate login and recovery on staff phones, weak-network retry, camera/photo upload, contractor language and navigation, and the factory terminal's inline issue form. Confirm a sample on the real printer/scanner and CNC workflow using a dry run without machine movement until the factory operator approves it.
- Validate provider delivery and failure handling in sandbox accounts or approved test recipients. Keep provider integrations outside the pilot scope until their owners approve endpoint, credentials, consent, escalation and failure evidence.
- Treat the CI launch rehearsal as synthetic baseline evidence. Repeat at pilot scale on production-like staging with representative concurrency, data and devices. Record p95, error count, database pool use, and recovery. Capacity of a live hosting tier requires separate evidence.
