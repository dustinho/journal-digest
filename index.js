#!/usr/bin/env nodejs

// Depends on: moment, evernote, gmail-send

// Start by reading some secrets
// client_secrets.json should have
// {
//  "gmail_user": "",
//  "gmail_to": "",
//  "gmail_app_pwd": "",
//  "evernote_dev_token": "",
//  "evernote_noteStore": ""
// }
//
// from https://dev.evernote.com/doc/articles/dev_tokens.php
// You'll need to request that the key be activated for production

const Evernote = require('evernote');
const fs = require('fs');
const path = require('path');

const content = fs.readFileSync(path.resolve(__dirname, 'client_secrets.json'));
const secrets = JSON.parse(content);

// Set up time strings
const moment = require('moment');

const now = moment();
// const now = moment('2017-06-17'); // For testing
const format = 'MMMM DD[,] YYYY';
const nowString = now.format(format);
const m7String = now.subtract({ days: 7 }).format(format);
const m30String = now.subtract({ days: 23 }).format(format);
const m90String = now.subtract({ days: 60 }).format(format);
const m365String = now.subtract({ days: 275 }).format(format);

function getMediaType(media) {
  if (media === '') {
    return '';
  }
  const index = media.indexOf('/') + 1;
  return media.slice(index);
}

// Look for a note with the date's title in the specified notebook.
// Returns Promise with HTML string

function findNoteFromDate(noteStore, dateString, notebookName) {
  var data = {};
  data.attach_paths = [];
  return new Promise((resolve, reject) => {
    const getNotebookGUID = noteStore.listNotebooks().then((notebooks) => {
      for (const i in notebooks) {
        if (notebooks[i].name === notebookName) {
          return notebooks[i].guid;
        }
      }
      return reject('No notebook found');
    })
    .catch((error) => {
      reject(error);
    });

    const metadataSpec = new Evernote.NoteStore.NotesMetadataResultSpec({
      includeTitle: true,
    });
    const noteSpec = new Evernote.NoteStore.NoteResultSpec({
      includeContent: true,
      includeResourcesData: true,
      includeResourcesRecognition: true,
    });

    const strictDateString = `"${dateString}"`;
    getNotebookGUID.then(id => new Evernote.NoteStore.NoteFilter({
      words: strictDateString,
      notebookGuid: id,
    }))
    .then(filter => noteStore.findNotesMetadata(filter, 0, 50, metadataSpec))
    .then((notesMetadataList) => {
      if (!notesMetadataList.notes[0]) {
        resolve(`No note found with: ${dateString}`);
      }
      return notesMetadataList.notes[0].guid;
    })
    .then(noteGuid => noteStore.getNoteWithResultSpec(
      noteGuid,
      noteSpec
    ))
    .then((note) => {
      // Save the content and then go get the attached resources
      data.content = note.content;
      if (!note.resources) {
        return Promise.resolve();
      }
      return Promise.all(
        note.resources.map((res) => {
          return noteStore.getResource(res.guid, true, true, true, true);
        })
      );
    })
    .then((resources) => {
      if (!resources) {
        return Promise.resolve();
      }

      // Write resources to files
      return Promise.all(
        resources.map((res) => {
          const filename = `attachments/${res.guid}.${getMediaType(res.mime)}`;
          data.attach_paths.push(filename);
          return fs.writeFile(filename, res.data.body);
        })
      );
    })
    .then(() => {
      resolve([data.content, data.attach_paths])
    })
    .catch((error) => {
      reject(error);
    });
  });
}

const client = new Evernote.Client({
	sandbox: false,
	token: secrets.evernote_dev_token,
});
const noteStore = client.getNoteStore();

// Format and send emails
const getNotes = [];
getNotes.push(findNoteFromDate(noteStore, m7String, 'Journal'));
getNotes.push(findNoteFromDate(noteStore, m30String, 'Journal'));
getNotes.push(findNoteFromDate(noteStore, m90String, 'Journal'));
getNotes.push(findNoteFromDate(noteStore, m365String, 'Journal'));
Promise.all(getNotes).then((notes) => {
  // Wish I had array_pull
  const filepaths = notes[0][1].concat(notes[1][1], notes[2][1], notes[3][1]);
  const html = `
      <big><b>-7</b></big>
      <br>
      <hr>
      ${notes[0][0]}

      <br><br><br>

      <big><b>-30</b></big>
      <br>
      <hr>
      ${notes[1][0]}

      <br><br><br>

      <big><b>-90</b></big>
      <br>
      <hr>
      ${notes[2][0]}

      <br><br><br>
      <big><b>-365</b></big>
      <br>
      <hr>
      ${notes[3][0]}
  `;

  const gmail_send = require('gmail-send')({
    user: secrets.gmail_user,
    pass: secrets.gmail_app_pwd,             // Has to be app-specific password
    to: secrets.gmail_to,
    subject: `Journal Digest: ${nowString}`,
    files: filepaths,
    // text: 'test text',
    html,
  });

  gmail_send({}, function (err, res) {
    if (err) {
      console.log('gmail_send() ERROR:', err);
    } else {
      console.log('gmail_send() SUCCESS:', res);

      // Delete attachments
      if (filepaths) {
        filepaths.forEach(file => fs.unlinkSync(file));
      }
    }
  });
})
.catch((error) => {
  console.log(error);
});
