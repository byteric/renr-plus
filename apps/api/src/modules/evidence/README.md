# evidence

Private PDF/PNG/JPEG attachments on actions, validated before S3 persistence.
Authentication, tenant scope and Origin are checked before multipart processing.
Uploads/archive append an action revision; downloads require authorization and
return attachments with no-store/nosniff. Logical archival retains bytes/history.
STORAGE_ENABLED=false keeps the feature safely unavailable without blocking actions.
See [HTTP reference](../../../../../docs/API_ACOES_EVIDENCIAS.md).
