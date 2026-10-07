#!/bin/sh
set -eu

bucket="${RENR_CHECK_BUCKET:-renr-evidence}"
if ! printf '%s' "$bucket" | grep -Eq '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$'; then
  echo 'Invalid local bucket name.' >&2
  exit 1
fi
base='http://127.0.0.1:9000'

signed_request() {
  curl --silent --show-error --aws-sigv4 'aws:amz:us-east-1:s3' \
    --user "$MINIO_ROOT_USER:$MINIO_ROOT_PASSWORD" "$@"
}

status=$(signed_request --head --output /dev/null --write-out '%{http_code}' "$base/$bucket")
case "$status" in
  200) ;;
  404) signed_request --fail -X PUT --output /dev/null "$base/$bucket" ;;
  *) echo "Bucket readiness failed: HTTP $status" >&2; exit 1 ;;
esac

anonymous=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' "$base/$bucket")
if [ "$anonymous" != '403' ]; then
  echo 'The local bucket must not allow anonymous listing.' >&2
  exit 1
fi

# Unique synthetic object, never an existing project/user file.
key="__local_verification__/$(date +%s)-$$.txt"
payload='ReNR+ local storage verification'
cleanup() {
  signed_request --fail -X DELETE --output /dev/null "$base/$bucket/$key"
}
trap cleanup EXIT
signed_request --fail -X PUT -H 'Content-Type: text/plain' --data-binary "$payload" \
  --output /dev/null "$base/$bucket/$key"
received=$(signed_request --fail "$base/$bucket/$key")
if [ "$received" != "$payload" ]; then
  echo 'Local object read does not match the uploaded content.' >&2
  exit 1
fi
cleanup
trap - EXIT
deleted=$(signed_request --head --output /dev/null --write-out '%{http_code}' "$base/$bucket/$key")
if [ "$deleted" != '404' ]; then
  echo 'Temporary verification object was not removed.' >&2
  exit 1
fi
echo 'MinIO S3 verified: private bucket, upload, read and temporary-object cleanup.'
