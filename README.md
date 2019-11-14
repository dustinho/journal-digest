# journal-digest

Simple nodejs script to send a digest of former journal entries to my email every day.

## Remember to:
* mkdir attachments
* fill in client_secrets.json

## Testing:

node index.js

## Common Errors:

* Getting "ThriftException { errorCode: 9, parameter: 'authenticationToken' }"
=> Check client_secrets.json
=> Generate a new token (yearly) https://dev.evernote.com/doc/articles/dev_tokens.php
