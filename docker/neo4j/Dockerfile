FROM neo4j:5

COPY docker/parse-templates.sh /parse-templates.sh

ADD docker/neo4j/templates /templates

COPY .env /.env
RUN /parse-templates.sh /templates /config /.env

CMD /config/start.sh
