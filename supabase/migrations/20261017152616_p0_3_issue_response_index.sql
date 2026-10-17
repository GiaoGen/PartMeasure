-- Cover the composite latest-response foreign key; history is append-only.
create index issues_latest_response_fk on pm.issues(project_id,id,latest_response_id);
