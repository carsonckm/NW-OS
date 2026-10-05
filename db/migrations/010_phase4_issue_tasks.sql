-- Phase 4: a task can be raised from an issue; the issue lists its tasks, the task shows
-- where it came from. One task table, one issue table: the link is a foreign key.
ALTER TABLE tasks ADD COLUMN issue_id text REFERENCES issues (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
CREATE INDEX tasks_issue_idx ON tasks (issue_id);
