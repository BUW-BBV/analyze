# Nightly snapshots of the analyzer database with restic (deduplicated: a snapshot only stores what changed).
FROM alpine:3.22
RUN apk add --no-cache restic sqlite tzdata
COPY backup.sh /usr/local/bin/backup.sh
RUN chmod 755 /usr/local/bin/backup.sh
USER 1000:1000
ENTRYPOINT ["/usr/local/bin/backup.sh"]
