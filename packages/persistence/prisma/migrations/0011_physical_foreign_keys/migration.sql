-- F-015: Restore physical foreign key integrity
-- Fails closed: if orphan rows exist, ALTER TABLE will abort with a constraint violation.
-- No data deletion, no silent correction, no NOT VALID.

-- outbox_events → projects
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE ON UPDATE CASCADE;

-- work_items.parent_id → work_items.id (self-referential hierarchy)
ALTER TABLE work_items ADD CONSTRAINT work_items_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES work_items(id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- artifact_records
ALTER TABLE artifact_records ADD CONSTRAINT artifact_records_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE artifact_records ADD CONSTRAINT artifact_records_work_item_id_fkey FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE artifact_records ADD CONSTRAINT artifact_records_attempt_id_fkey FOREIGN KEY (attempt_id) REFERENCES attempts(id) ON DELETE SET NULL ON UPDATE CASCADE;

-- evidence_records
ALTER TABLE evidence_records ADD CONSTRAINT evidence_records_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE evidence_records ADD CONSTRAINT evidence_records_work_item_id_fkey FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE evidence_records ADD CONSTRAINT evidence_records_attempt_id_fkey FOREIGN KEY (attempt_id) REFERENCES attempts(id) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE evidence_records ADD CONSTRAINT evidence_records_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES artifact_records(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE evidence_records ADD CONSTRAINT evidence_records_approval_id_fkey FOREIGN KEY (approval_id) REFERENCES approvals(id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- verification_records
ALTER TABLE verification_records ADD CONSTRAINT verification_records_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE verification_records ADD CONSTRAINT verification_records_work_item_id_fkey FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE verification_records ADD CONSTRAINT verification_records_attempt_id_fkey FOREIGN KEY (attempt_id) REFERENCES attempts(id) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE verification_records ADD CONSTRAINT verification_records_completion_decision_id_fkey FOREIGN KEY (completion_decision_id) REFERENCES completion_decisions(id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- completion_decisions
ALTER TABLE completion_decisions ADD CONSTRAINT completion_decisions_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE completion_decisions ADD CONSTRAINT completion_decisions_evaluated_work_item_id_fkey FOREIGN KEY (evaluated_work_item_id) REFERENCES work_items(id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- approvals
ALTER TABLE approvals ADD CONSTRAINT approvals_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE approvals ADD CONSTRAINT approvals_work_item_id_fkey FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE approvals ADD CONSTRAINT approvals_attempt_id_fkey FOREIGN KEY (attempt_id) REFERENCES attempts(id) ON DELETE SET NULL ON UPDATE CASCADE;

-- execution_log_records
ALTER TABLE execution_log_records ADD CONSTRAINT execution_log_records_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE execution_log_records ADD CONSTRAINT execution_log_records_work_item_id_fkey FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE execution_log_records ADD CONSTRAINT execution_log_records_attempt_id_fkey FOREIGN KEY (attempt_id) REFERENCES attempts(id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- incident_event_records (recovery_evidence_id excluded: TEXT→UUID type mismatch, see F015-R1)
ALTER TABLE incident_event_records ADD CONSTRAINT incident_event_records_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE incident_event_records ADD CONSTRAINT incident_event_records_work_item_id_fkey FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE incident_event_records ADD CONSTRAINT incident_event_records_attempt_id_fkey FOREIGN KEY (attempt_id) REFERENCES attempts(id) ON DELETE RESTRICT ON UPDATE CASCADE;
