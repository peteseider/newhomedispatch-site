// Uploads the rendered social cards to a Google Drive folder using a service account.
// Runs in CI only when the GDRIVE_SA secret + GDRIVE_FOLDER variable are set.
const fs = require('fs');
const { google } = require('googleapis');
(async () => {
  const key = JSON.parse(process.env.GDRIVE_SA);
  const folderId = process.env.GDRIVE_FOLDER;
  if (!folderId) { console.log('GDRIVE_FOLDER not set; skipping'); return; }
  const auth = new google.auth.GoogleAuth({ credentials: key, scopes: ['https://www.googleapis.com/auth/drive'] });
  const drive = google.drive({ version: 'v3', auth });
  for (const n of ['read','move','explained','rate','illusion']) {
    const path = `share/hot-sheet-${n}.png`;
    if (!fs.existsSync(path)) continue;
    const title = `hot-sheet-${n}.png`;
    const q = `name='${title}' and '${folderId}' in parents and trashed=false`;
    const found = await drive.files.list({ q, fields: 'files(id)' });
    const media = { mimeType: 'image/png', body: fs.createReadStream(path) };
    if (found.data.files.length) { await drive.files.update({ fileId: found.data.files[0].id, media }); console.log('updated', title); }
    else { await drive.files.create({ requestBody: { name: title, parents: [folderId] }, media }); console.log('created', title); }
  }
})().catch(e => { console.error(e); process.exit(1); });
