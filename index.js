import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import axios from 'axios';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

dotenv.config();

// Define __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors({ origin: 'http://localhost:3000', credentials: true }));
app.use(cookieParser());

// Serve static files from client directory
app.use(express.static(path.join(__dirname, "static")));

// Serve index.html for the root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'static', 'index.html'));
});

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;

// console.log('Client ID:', CLIENT_ID);

const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const SCOPES = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email'
];

// Route to initiate OAuth
app.get('/auth/google', (req, res) => {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
  });
  res.redirect(authUrl);
});

// OAuth2 callback
app.get('/auth/google/callback', async (req, res) => {
  const code = req.query.code;
  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);
  res.cookie('token', JSON.stringify(tokens), { httpOnly: true });
  res.redirect('/'); // Redirect to our static frontend
});

// Logout route
app.get('/logout', async (req, res) => {
  try {
    const token = req.cookies.token;
    
    // Only attempt to revoke if we have a token
    if (token) {
      const parsedToken = JSON.parse(token);
      // Revoke the token if it exists
      if (parsedToken.access_token) {
        try {
          await oAuth2Client.revokeToken(parsedToken.access_token);
        } catch (error) {
          console.error('Error revoking token:', error);
          // Continue with logout even if revoke fails
        }
      }
    }
    
    // Clear the cookie
    res.clearCookie('token');
    
    // Simply redirect to the home page after clearing the token
    // The next login attempt will automatically show the account selection
    res.redirect('/');
  } catch (error) {
    console.error('Error during logout:', error);
    res.clearCookie('token');
    res.redirect('/');
  }
});

// Middleware to set credentials
app.use(async (req, res, next) => {
  try {
    const token = req.cookies.token;
    if (token) {
      const parsedToken = JSON.parse(token);
      oAuth2Client.setCredentials(parsedToken);
      
      // Check if token is expired and needs refresh
      if (parsedToken.expiry_date && Date.now() > parsedToken.expiry_date) {
        if (parsedToken.refresh_token) {
          try {
            const response = await oAuth2Client.refreshToken(parsedToken.refresh_token);
            const newToken = response.tokens;
            
            // Make sure to preserve the refresh token
            if (!newToken.refresh_token && parsedToken.refresh_token) {
              newToken.refresh_token = parsedToken.refresh_token;
            }
            
            oAuth2Client.setCredentials(newToken);
            res.cookie('token', JSON.stringify(newToken), { httpOnly: true });
          } catch (refreshError) {
            console.error('Error refreshing token:', refreshError);
            // Clear invalid token and redirect to login
            res.clearCookie('token');
            if (req.path !== '/' && !req.path.startsWith('/auth')) {
              return res.redirect('/');
            }
          }
        } else {
          // No refresh token, clear cookie and redirect to login
          res.clearCookie('token');
          if (req.path !== '/' && !req.path.startsWith('/auth')) {
            return res.redirect('/');
          }
        }
      }
    } else {
      // If routes require authentication and no token exists, redirect to home
      if (
        req.path !== '/' && 
        !req.path.startsWith('/auth') && 
        req.path !== '/logout' &&
        !req.path.includes('.') // Skip static files
      ) {
        return res.status(401).json({ error: 'Authentication required' });
      }
    }
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.clearCookie('token');
    if (req.path !== '/' && !req.path.startsWith('/auth')) {
      return res.redirect('/');
    }
    next();
  }
});

// Get user's classroom courses
app.get('/courses', async (req, res) => {
  const classroom = google.classroom({ version: 'v1', auth: oAuth2Client });
  const result = await classroom.courses.list();
  res.json(result.data.courses || []);
});

// Get user info
app.get('/user-info', async (req, res) => {
  try {
    const oauth2 = google.oauth2({ version: 'v2', auth: oAuth2Client });
    const userInfo = await oauth2.userinfo.get();
    
    // Create a proxy for the profile image
    const pictureUrl = userInfo.data.picture;
    const profileImgId = Buffer.from(pictureUrl).toString('base64');
    
    res.json({
      name: userInfo.data.name,
      email: userInfo.data.email,
      picture: `/profile-image/${profileImgId}` // Use a proxied URL instead of direct Google URL
    });
  } catch (error) {
    console.error('Error fetching user info:', error);
    res.status(500).json({ error: 'Failed to fetch user info' });
  }
});

// Proxy route for profile images
app.get('/profile-image/:id', async (req, res) => {
  try {
    const pictureUrl = Buffer.from(req.params.id, 'base64').toString();
    
    // Fetch the image using axios with the auth token
    const response = await axios.get(pictureUrl, {
      responseType: 'arraybuffer',
      headers: {
        'Authorization': `Bearer ${oAuth2Client.credentials.access_token}`
      }
    });
    
    // Set appropriate content type
    res.set('Content-Type', response.headers['content-type'] || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
    
    // Send the image data
    res.send(Buffer.from(response.data));
  } catch (error) {
    console.error('Error fetching profile image:', error);
    // Send a default profile image
    res.redirect('https://ui-avatars.com/api/?name=User&background=1a73e8&color=fff&size=96');
  }
});

// Get materials for a course
app.get('/courses/:courseId/materials', async (req, res) => {
  const classroom = google.classroom({ version: 'v1', auth: oAuth2Client });
  const result = await classroom.courses.courseWorkMaterials.list({
    courseId: req.params.courseId
  });

  res.json(result.data.courseWorkMaterial || []);
});

// Download all attachments for a course
app.get('/courses/:courseId/download', async (req, res) => {
  const courseId = req.params.courseId;
  const classroom = google.classroom({ version: 'v1', auth: oAuth2Client });
  const drive = google.drive({ version: 'v3', auth: oAuth2Client });

  try {
    // Get course details to include in the summary
    const courseDetails = await classroom.courses.get({ id: courseId });
    const courseName = courseDetails.data.name || `Course_${courseId}`;
    
    const materialRes = await classroom.courses.courseWorkMaterials.list({ courseId });
    const materials = materialRes.data.courseWorkMaterial || [];

    const archive = archiver('zip', { zlib: { level: 9 } });
    res.attachment(`${courseName.replace(/[^\w\s]/gi, '_')}_materials.zip`);
    archive.pipe(res);

    // Track total size
    let totalSize = 0;
    const fileSizes = {};
    const filesList = [];

    // Process each material
    for (const material of materials) {
      const topic = material.title || 'Untitled';
      
      // Check for individual file attachments
      if (material.materials) {
        for (const materialItem of material.materials) {
          // Handle direct file attachments
          if (materialItem.driveFile) {
            const fileSize = await addDriveFileToArchive(materialItem.driveFile.driveFile.id, `${topic}`, drive, archive);
            if (fileSize) {
              totalSize += fileSize;
              fileSizes[`${topic}/${materialItem.driveFile.driveFile.title || 'Untitled'}`] = formatBytes(fileSize);
            }
          }
          
          // Handle folder attachments
          if (materialItem.driveFolder) {
            const folderSize = await processDriveFolder(materialItem.driveFolder.driveFolder.id, `${topic}`, drive, archive);
            totalSize += folderSize;
          }
        }
      }
      
      // Handle legacy single material format
      if (material.material) {
        if (material.material.driveFile) {
          const fileSize = await addDriveFileToArchive(material.material.driveFile.driveFile.id, `${topic}`, drive, archive);
          if (fileSize) {
            totalSize += fileSize;
            fileSizes[`${topic}/${material.material.driveFile.driveFile.title || 'Untitled'}`] = formatBytes(fileSize);
          }
        }
        
        if (material.material.driveFolder) {
          const folderSize = await processDriveFolder(material.material.driveFolder.driveFolder.id, `${topic}`, drive, archive);
          totalSize += folderSize;
        }
      }
    }

    // console.table(fileSizes);
    
    // Generate summary file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const summaryFilename = `summary-${courseName.replace(/[^\w\s]/gi, '_')}-${timestamp}.txt`;
    
    let summaryContent = `Download Summary for: ${courseName}\n`;
    summaryContent += `Generated on: ${new Date().toLocaleString()}\n`;
    summaryContent += `Total size: ${formatBytes(totalSize)}\n\n`;
    summaryContent += `Files:\n`;
    
    // Add all files with their sizes to the summary
    Object.keys(fileSizes).sort().forEach(filePath => {
      summaryContent += `${filePath} (${fileSizes[filePath]})\n`;
    });
    
    // Add the summary file to the zip only
    archive.append(summaryContent, { name: `_${summaryFilename}` });
    
    // No longer saving to local downloads folder

    archive.finalize();
  } catch (error) {
    console.error('Error processing download:', error);
    res.status(500).json({ error: 'Failed to download course materials' });
  }
});

// Helper function to process all files in a Drive folder (including nested folders)
async function processDriveFolder(folderId, parentPath, drive, archive) {
  try {
    // Get folder details
    const folderMeta = await drive.files.get({ fileId: folderId, fields: 'name' });
    const folderName = folderMeta.data.name;
    const folderPath = `${parentPath}/${folderName}`;
    
    // List all files in the folder
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'files(id, name, mimeType, size)'
    });
    
    const files = res.data.files || [];
    let folderSize = 0;
    
    // Process each file/subfolder
    for (const file of files) {
      if (file.mimeType === 'application/vnd.google-apps.folder') {
        // Recursively process subfolders
        const subFolderSize = await processDriveFolder(file.id, folderPath, drive, archive);
        folderSize += subFolderSize;
      } else {
        // Add file to archive
        const fileSize = await addDriveFileToArchive(file.id, folderPath, drive, archive);
        folderSize += fileSize || 0;
      }
    }
    
    return folderSize;
  } catch (err) {
    console.error(`Error processing folder ${folderId}:`, err.message);
    return 0;
  }
}

// Helper function to add a Drive file to the archive
async function addDriveFileToArchive(fileId, parentPath, drive, archive) {
  try {
    const fileMeta = await drive.files.get({ 
      fileId, 
      fields: 'name,mimeType,size' 
    });
    
    const fileName = fileMeta.data.name;
    let fileSize = parseInt(fileMeta.data.size) || 0;
    
    // Handle Google Docs, Sheets, etc. by exporting them
    if (fileMeta.data.mimeType.startsWith('application/vnd.google-apps')) {
      let exportMimeType;
      let exportExtension;
      
      // Choose export formats based on Google file type
      switch (fileMeta.data.mimeType) {
        case 'application/vnd.google-apps.document':
          exportMimeType = 'application/pdf';
          exportExtension = 'pdf';
          break;
        case 'application/vnd.google-apps.spreadsheet':
          exportMimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
          exportExtension = 'xlsx';
          break;
        case 'application/vnd.google-apps.presentation':
          exportMimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
          exportExtension = 'pptx';
          break;
        default:
          exportMimeType = 'application/pdf';
          exportExtension = 'pdf';
      }
      
      const exported = await drive.files.export(
        { fileId, mimeType: exportMimeType },
        { responseType: 'stream' }
      );
      
      // For exported files, we estimate size since it's not directly available
      fileSize = 1024 * 1024; // Estimate 1MB for exported files
      
      archive.append(exported.data, { name: `${parentPath}/${fileName}.${exportExtension}` });
    } else {
      // Regular files downloaded directly
      const fileStream = await drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'stream' }
      );
      
      archive.append(fileStream.data, { name: `${parentPath}/${fileName}` });
    }
    
    // console.log(`Downloaded: ${parentPath}/${fileName} (${formatBytes(fileSize)})`);
    return fileSize;
  } catch (err) {
    console.error(`Error downloading file ${fileId}:`, err.message);
    return 0;
  }
}

// Helper function to format bytes to human-readable format
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

app.listen(5000, () => {
//   console.log('Backend running on http://localhost:5000');
});
