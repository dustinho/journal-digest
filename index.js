#!/usr/bin/env nodejs

// Depends on: moment, evernote, gmail-send

// Start by reading some secrets
// client_secrets.json should have
// {
//  "gmail_user": "",
//  "gmail_to": "",
//  "gmail_app_pwd": "",
//  "evernote_dev_token": "",
//  "evernote_noteStore": "",
//  "snitch_url": ""
// }
//
// Evernote tokens from https://dev.evernote.com/doc/articles/dev_tokens.php
// You'll need to request that the key be activated for production
//
// Snitch from deadmanssnitch.com
//
// Gmail app pwd needs to be request / 2FA enabled

const Evernote = require('evernote');
const fs = require('fs');
const nodemailer = require('nodemailer');
const path = require('path');
const request = require('request');

const content = fs.readFileSync(path.resolve(__dirname, 'client_secrets.json'));
const secrets = JSON.parse(content);

// Set up time strings
const moment = require('moment');

const now = moment();
// const now = moment('2018-02-01'); // For testing
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
  const data = {};
  data.attachPaths = [];
  return new Promise((resolve, reject) => {
    const getNotebookGUID = noteStore.listNotebooks().then((notebooks) => {
      for (let i = 0; i < notebooks.length; i += 1) {
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
      noteSpec,
    ))
    .then((note) => {
      // Save the content and then go get the attached resources
      data.content = note.content;
      if (!note.resources) {
        return Promise.resolve();
      }
      return Promise.all(
        note.resources.map(res => noteStore.getResource(res.guid, true, true, true, true)),
      );
    })
    .then((resources) => {
      if (!resources) {
        return Promise.resolve();
      }

      // Write resources to files
      return Promise.all(
        resources.map((res) => {
          const filename = `/home/dho/scripts/journal-digest/attachments/${res.guid}.${getMediaType(res.mime)}`;
          data.attachPaths.push(filename);
          // console.log("writing to:" + filename);
          return fs.writeFile(filename, res.data.body, (err) => {
            if (err) {
              console.log(`error:${err}`);
              throw err;
            }
          });
        }),
      );
    })
    .then(() => {
      resolve([data.content, data.attachPaths]);
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
  // Generate attachments and embedded images
  const attachments = [];
  const embeddedImages = ['', '', '', ''];
  for (let i = 0; i < 4; i += 1) {
    // Make sure we check for "No note found with:" when pulling note info
    if (Array.isArray(notes[i])) {
      const attachPaths = notes[i][1];
      for (let j = 0; j < attachPaths.length; j += 1) {
        const cid = `image_${i}_${j}`;
        const embedString = `<img src="cid:${cid}" width="100%"/>`;

        attachments.push({
          cid,
          path: attachPaths[j],
        });
        embeddedImages[i] += embedString;
      }
    }
  }

  const html = `
      <br>  
      <br>  

      <big><b>-7</b></big>
      <br>
      <hr>
      ${notes[0][0]}
      ${embeddedImages[0]}

      <br><br><br>

      <big><b>-30</b></big>
      <br>
      <hr>
      ${notes[1][0]}
      ${embeddedImages[1]}

      <br><br><br>

      <big><b>-90</b></big>
      <br>
      <hr>
      ${notes[2][0]}
      ${embeddedImages[2]}

      <br><br><br>
      <big><b>-365</b></big>
      <br>
      <hr>
      ${notes[3][0]}
      ${embeddedImages[3]}
  `;

  // Send some mail!

  const transporter = nodemailer.createTransport({
    service: 'Gmail',
    auth: {
      user: secrets.gmail_user,
      pass: secrets.gmail_app_pwd,
    },
  });

  const mailOptions = {
    from: secrets.gmail_user,
    to: secrets.gmail_to,
    subject: `Journal Digest: ${nowString}`,
    attachments,
    html,
  };

  return transporter.sendMail(mailOptions, (err, info) => {
    // Delete attachments
    if (attachments) {
      attachments.forEach(attachment => fs.unlinkSync(attachment.path));
    }

    if (err) {
      console.log('ERROR:', err);
    } else {
      // Send Deadman's Switch to track failures
      request(secrets.snitch_url);
      console.log('SUCCESS:', info);
    }
  });
})
.catch((error) => {
  console.log(error);
});
