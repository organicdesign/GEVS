#!/bin/bash

# turn on bash's job control
set -m

# Start the primary process and put it in the background
/startup/docker-entrypoint.sh neo4j &

until cypher-shell -u neo4j -p "{{ NEO4J_ADMIN_PASSWORD }}" "CREATE USER {{ NEO4J_LOCAL_USER }} IF NOT EXISTS SET PASSWORD '{{ NEO4J_LOCAL_PASSWORD }}' CHANGE NOT REQUIRED;"
do
  sleep 10
done


fg %1
