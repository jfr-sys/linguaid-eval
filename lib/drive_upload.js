/**
 * drive_upload.js
 * Helper module to push candidate documents to the correct Google Drive
 * learner folder: {Trainer} Learners / 01 Current Students / {Learner Name}
 */
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const CREDENTIALS_PATH = path.join(__dirname, '../drive_credentials.json');

// Root "Learner Files" folder ID - set this after first run via FIND_ROOT script,
// or pass explicitly when calling pushCandidateDocs.
const LEARNER_FILES_ROOT_ID = process.env.LEARNER_FILES_ROOT_ID || null;

// Per-user token files: drive_token_<userId>.json. Falls back to drive_token.json
// (legacy, originally Joss's) when no per-user token exists yet.
function getDriveClient(userId) {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error('Drive not configured. drive_credentials.json missing.');
  }
  var tokenPath = userId
    ? path.join(__dirname, '../drive_token_' + userId + '.json')
    : path.join(__dirname, '../drive_token.json');
  if (!fs.existsSync(tokenPath)) {
    var fallback = path.join(__dirname, '../drive_token.json');
    if (userId && fs.existsSync(fallback)) {
      tokenPath = fallback;
    } else {
      throw new Error('Drive not authorized for this user. Run authorize_drive_user.js ' + (userId || '') + ' first.');
    }
  }
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
  const token = JSON.parse(fs.readFileSync(tokenPath));
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
  oAuth2Client.setCredentials(token);
  return google.drive({ version: 'v3', auth: oAuth2Client });
}

async function findFolder(drive, name, parentId) {
  const q = `name = '${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const res = await drive.files.list({ q, fields: 'files(id, name)', spaces: 'drive' });
  return res.data.files && res.data.files.length ? res.data.files[0] : null;
}

async function createFolder(drive, name, parentId) {
  const res = await drive.files.create({
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    fields: 'id, name'
  });
  return res.data;
}

async function findOrCreateFolder(drive, name, parentId) {
  const existing = await findFolder(drive, name, parentId);
  if (existing) return existing;
  return createFolder(drive, name, parentId);
}

/**
 * Trainer first-name to folder-name mapping (matches Drive structure: "Anna Learners", "Hannah Learners", etc.)
 */
const TRAINER_FOLDER_MAP = {
  hannah: 'Hannah Learners',
  anna: 'Anna Learners',
  louiseg: 'Louise G Learners',
  louisek: 'Louise K Learners',
  leone: 'Leone Learners',
  natasha: 'Natasha Learners',
  lynsey: 'Lynsey Learners',
  stephanie: 'Stephanie Learners',
  joss: 'Joss Learners'
};

// Known "01 Current Students" folder IDs per trainer - bypasses name search when present.
// Add more as they're confirmed to avoid 404s from name-matching issues.
const CURRENT_STUDENTS_FOLDER_IDS = {
  natasha: '1z2YlhCnl5ZaUuNMpTtJOHBA2UwUWCxN5',
  anna: '1gZkXUM646S4Q1P_1ejdD2ZOrhZaL0sFd',
  hannah: '1gkYeDQbxs-EkFMDW9DCOZzFcyUMQCq9p',
  leone: '1ySd_iFujL9KVpP8xXCAmf5IO-9qGfo93',
  louiseg: '12WPk4hMsA3MWNX4I-gvjZh_dY_yaaFMJ',
  louisek: '1ksXb1p3YkvLh6zDXeGnCJzFqKVvbUb0f',
  lynsey: '15c1lr7vPeCHB52BLPWLfzwL5BsFkuBmU',
  stephanie: '1xu2GNVyCFzsftOZvFzL2EW_2NpTgFEr_'
};

/**
 * Push a list of local file paths into the learner's Drive folder.
 * @param {Object} opts
 * @param {string} opts.trainerKey - key from CONVOC_TRAINERS (e.g. 'hannah', 'anna')
 * @param {string} opts.learnerName - candidate full name
 * @param {Array<{path: string, name: string}>} opts.files - local files to upload
 * @param {string} [opts.rootFolderId] - override LEARNER_FILES_ROOT_ID
 */
async function pushCandidateDocs({ trainerKey, learnerName, files, rootFolderId, userId }) {
  const drive = getDriveClient(userId);
  const rootId = rootFolderId || LEARNER_FILES_ROOT_ID;
  if (!rootId) throw new Error('Learner Files root folder ID not configured');

  const key = (trainerKey || '').toLowerCase();
  const trainerFolderName = TRAINER_FOLDER_MAP[key];
  if (!trainerFolderName) throw new Error('Unknown trainer key: ' + trainerKey);

  let currentStudentsFolderId = CURRENT_STUDENTS_FOLDER_IDS[key];

  if (!currentStudentsFolderId) {
    const trainerFolder = await findFolder(drive, trainerFolderName, rootId);
    if (!trainerFolder) throw new Error('Trainer folder not found: ' + trainerFolderName);
    const currentStudentsFolder = await findOrCreateFolder(drive, '01 Current Students', trainerFolder.id);
    currentStudentsFolderId = currentStudentsFolder.id;
  }

  const learnerFolder = await findOrCreateFolder(drive, learnerName, currentStudentsFolderId);

  const uploaded = [];
  for (const f of files) {
    if (!fs.existsSync(f.path)) continue;
    const res = await drive.files.create({
      requestBody: { name: f.name, parents: [learnerFolder.id] },
      media: { mimeType: 'application/pdf', body: fs.createReadStream(f.path) },
      fields: 'id, name, webViewLink'
    });
    uploaded.push(res.data);
  }

  return { learnerFolderId: learnerFolder.id, learnerFolderUrl: 'https://drive.google.com/drive/folders/' + learnerFolder.id, uploaded };
}

module.exports = { pushCandidateDocs, getDriveClient, TRAINER_FOLDER_MAP };
