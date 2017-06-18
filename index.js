#!/usr/bin/env nodejs

// Depends on: moment, evernote, gmail-send

// Start by reading some secrets
// client_secrets.json should have
// {
//  "gmail_user": "",
//  "gmail_to": "",
//  "gmail_app_pwd": "",
//  "evernote_dev_token": "",
//  "evernote_notestore": ""
// }
//
// from https://dev.evernote.com/doc/articles/dev_tokens.php
// You'll need to request that the key be activated for production

var fs = require('fs');
content = fs.readFileSync('client_secrets.json');
secrets = JSON.parse(content);

// Set up time strings
const moment = require('moment');
var now = moment();
//var now = moment("2017-06-17");
var format = 'MMMM DD[,] YYYY';
var now_string = now.format(format);
var m7_string = now.subtract({days:7}).format(format);
var m30_string = now.subtract({days:23}).format(format);
var m365_string = now.subtract({days:335}).format(format);

// Evernote
var Evernote = require('evernote');
var client = new Evernote.Client({token: secrets.evernote_sb_token});
var noteStore = client.getNoteStore();

var get_notes = [];
get_notes.push(findNoteFromDate(noteStore, m7_string, 'Journal'));
get_notes.push(findNoteFromDate(noteStore, m30_string, 'Journal'));
get_notes.push(findNoteFromDate(noteStore, m365_string, 'Journal'));
Promise.all(get_notes).then(function(notes) {

  // HTML format and send email
  var html = `
      <big><b>-7</b></big>
      <br>
      <hr>
      ${notes[0]}

      <br><br><br>

      <big><b>-30</b></big>
      <br>
      <hr>
      ${notes[1]}

      <br><br><br>

      <big><b>-365</b></big>
      <br>
      <hr>
      ${notes[2]}
  `;

  var gmail_send = require('gmail-send')({
    user: secrets.gmail_user,
    pass: secrets.gmail_app_pwd,             // Has to be app-specific password
    to: secrets.gmail_to,
    subject: 'Journal Digest: ' + now_string,
    //text:    'test text',
    html: html,
  });

  gmail_send({}, function (err, res) {
    if (err) {
      console.log('gmail_send() ERROR:', err);
    } else {
      console.log('gmail_send() SUCCESS:', res);
    }
  });
}).catch(function(error) {
  console.log(error);
});


// Look for a note with the date's title in the specified notebook.
// Returns Promise with HTML string

function findNoteFromDate(notestore, date_string, notebook_name) {
  return new Promise(function(resolve, reject) {
    var getNotebookGUID = notestore.listNotebooks().then(function(notebooks) {
      for (var i in notebooks) {
        if (notebooks[i].name == notebook_name) {
          return notebooks[i].guid;
        }
      }
    }).catch(function(error) {
        reject(error);
    });

    var metadata_spec = new Evernote.NoteStore.NotesMetadataResultSpec({
      includeTitle: true,
    });
    var note_spec = new Evernote.NoteStore.NoteResultSpec({
      includeContent: true,
      includeResourcesData: true,
      includeResourcesRecognition: true,
    });

    var getNote = getNotebookGUID.then(function(id) {
      return new Evernote.NoteStore.NoteFilter({
        words: date_string,
        notebookGuid: id,
      });
    }).then(function(filter) {
      return notestore.findNotesMetadata(filter, 0, 50, metadata_spec);
    }).then(function(notesMetadataList) {
      if (!notesMetadataList.notes[0]){
        resolve("No note found with: " + date_string);
      }
      return notesMetadataList.notes[0].guid;
    }).then(function(note_guid) {
      return notestore.getNoteWithResultSpec(note_guid, note_spec);
    }).then(function(note) {
      resolve(note.content);
    }).catch(function(error) {
      reject(error);
    });
  })
}
