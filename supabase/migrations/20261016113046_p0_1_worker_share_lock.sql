-- SELECT FOR UPDATE needs UPDATE on at least one column; worker never mutates links.
grant update(id) on pm.share_links to partmeasure_worker;
