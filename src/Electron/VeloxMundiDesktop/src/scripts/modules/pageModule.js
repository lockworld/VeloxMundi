const {app, dialog, BrowserWindow, webContents} = require('electron');
const { file } = require('electron-settings');
const fs = require('fs');
const fse = require('fs-extra');
let path = require('path');
const { config } = require('process');
const jsdom = require('jsdom');
const { triggerAsyncId } = require('async_hooks');

// variables
const pubDirName = '_web';



// Custom Modules
const configManager = require(path.join(app.getAppPath(), 'src', 'scripts', 'modules', 'configModule.js'));
const fileManager = require(path.join(app.getAppPath(), 'src', 'scripts', 'modules', 'fileManagerModule.js'));
const worldManager = require(path.join(app.getAppPath(), 'src','scripts', 'modules', 'worldModule.js'));
let modal = null;
let saveAsEvent = null;


module.exports = class ConfigManager {
  constructor() {
    this.configpath = "";
  }

  static Invoke(event, method, data) {
    switch(method) {      
      case 'ReadPage':
        return this.ReadPage(data);
        break;
      case 'SavePage':
        return this.SavePage(data);
        break;
      case 'GetPagePath':
        return this.GetPagePath(data);
        break;
      case 'GetPageDataFromNameDisambiguation':
        return this.GetPageDataFromNameDisambiguation(data);
        break;
      case 'NewPageType':
        return this.NewPageType(data);
        break;
      case 'SetSaveAsName':
        return this.SetSaveAsName(event, data);
        break;
      case 'DeletePage':
        return this.DeletePage(data);
        break;
      case 'RenamePage':
        return this.RenamePage(data);
        break;        
      case 'NewPage':
        this.NewPage(event);
        break;
      case 'Convert':
        return this.Convert(event, data);
      case 'GetPageData':
        return this.GetPageData(data);
        break;
      default:
        return null;
        break;
    }
  }
  
  
  static ReadPage(pagePath) {
    let pageContents = '';
    let fileType = pagePath.split('.').pop();
    switch(fileType) {
      case 'html':
        let html = fileManager.ReadFileToString(pagePath);
        html = this.tweakHTML('read', html, pagePath);
        return html;
        break;
      case 'md':
        let md = fileManager.ReadFileToString(pagePath);
        md = this.tweakMD('read', md, pagePath);
        return md;
        break;
      default:
        return fileManager.ReadFileToString(pagePath);
        break;
    }
    return pageContents;
  }
  
  static SavePage(pageInfo) {
    /* pageInfo contains:
     fileType,
     pageContents,
     pageName,
     pageType,
    */
    try {
      let basePath = path.join(configManager.ReadKey('WorldDirectory'),configManager.ReadKey('CurrentWorld'));
      let pageDir = path.join(basePath, 'pages', pageInfo.pageType);
      if (!fs.existsSync(pageDir)) {
        fs.mkdirSync(pageDir);
      }
      let pagePath = path.join(pageDir, pageInfo.pageName + '.' + pageInfo.fileType);
      let contents = (pageInfo.fileType=='md' ? this.tweakMD('save', pageInfo.pageContents, pagePath) : this.tweakHTML('save', pageInfo.pageContents, pagePath));
      fs.writeFileSync(pagePath, contents);   

      // publish page in HTML output directory
      let pubDir = path.join(basePath, pubDirName, pageInfo.pageType, pageInfo.pageName);
      fse.ensureDirSync(pubDir);
      let pubPath = path.join(pubDir, 'index.html');
      fs.writeFileSync(pubPath, this.publishHTML('save',pageInfo.pageHTML));
      
      try {
        this.AddPageToIndex(pagePath, true);
        //this.BuildWebIndex();
        return {
          'success': true, 
          'message': 'Saved file successfully!'
        };
      }
      catch(e) {
        return {
          'success': false, 
          'message': 'Page was saved, but page info was not added to index: ' + e
        };
      }
    }
    catch(e) {
      return {
        'success': false, 
        'message': 'Unable to save file: ' + e
      };
    }
  }

  static AddPageToIndex(pagePath, SaveNow) {
    // Set up variables
    let pageData = this.GetPageData({
      fullPath: pagePath
    });
    let olinks = [];    

    // Read world index
    let worldData = worldManager.GetWorldData();
    let thisPage = {
      name : pageData.relFileName,
      nameDisambiguation : pageData.relFileName + (pageData.pageType=='' ? '' : ' (' + pageData.pageType + ')'),
      type : pageData.pageType,
      fileType : pageData.fileExt,
      relPath : pageData.relPath
    }
    if (SaveNow) {
      thisPage.saved = new Date(Date.now()).toLocaleString();
      if (pageData.fileExt=='html') {
        try {
          let pageHTML = '';
          pageHTML = fs.readFileSync(pageData.fullPath).toString();
          let dom = new jsdom.JSDOM(`<!DOCTYPE html><body>${pageHTML}</body>`);
          let jquery = require('jquery')(dom.window);
          let $ = jquery;
          let lnks = $('a');
          $('a').each(function() {
            try {
              let ths = $(this);
              let href = decodeURIComponent(ths.attr('href'));
              let baseHref = decodeURIComponent('file:///' + basePath);
              if (href.indexOf(baseHref)!=-1) {
                href = href.replace(baseHref,'');
                let existingO = olinks.indexOf(href);
                if (existingO==-1) {
                  olinks.push(href);
                }
              }
            }
            catch(e) {
              console.log(e);
            }
          });
        } 
        catch(e) {
          // Fail silently if links cannot be indexed for some reason.
          console.log(e);
        }
      }
      else if (pageData.fileExt=='md') {
        // Use RegEx to parse links in MD files
      }
      thisPage.outgoingLinks = olinks;
    }
    
    if (!worldData.pages || worldData.pages.length==0) {
      worldData.pages = [thisPage];
    }
    
    for (let i=0; i<worldData.pages.length; i++) {
      let dataPageNameLower = worldData.pages[i].name;
      if (worldData.pages[i].relPath==pageData.relPath) {
        worldData.pages[i] = thisPage;
      }
    }
    let dataThisPage = worldData.pages.filter(function(p) {
      return p.relPath==pageData.relPath
    });
    if (!dataThisPage || dataThisPage.length==0) {
      worldData.pages.push(thisPage);
    }
    
    worldData.pages.sort((a,b) => {
      if (a.type>b.type) {
        return 1;
      }
      else if (a.type<b.type) {
        return -1
      }
      else {
        if (a.name>b.name) {
          return 1;
        }
        else if (a.name<b.name) {
          return -1;
        }
        else {
          return 0;
        }
      }
      });
    worldManager.SaveWorldData(worldData);

  }

  static RemovePageFromIndex(pageInfo) {
    if (pageInfo.pageRelPath) {
      let worldData = worldManager.GetWorldData();
      worldData.pages = worldData.pages.filter(function(p) {
        return p.relPath!=pageInfo.pageRelPath
      });
      worldManager.SaveWorldData(worldData);
    }
    else if (pageInfo.pagePath) {
      let pageData = this.GetPageData({
        fullPath: pageInfo.pagePath
      });
      let worldData = worldManager.GetWorldData();
      worldData.pages = worldData.pages.filter(function(p) {
        return p.relPath!=pageData.relPath
      });
      worldManager.SaveWorldData(worldData);
    }
    else {
      return {
        success: false,
        message: 'Unable to remove page from index. Please specify a PageRelPath or PagePath.'
      };
    }

  }


  static publishHTML(pageInfo, html) {
    //TODO: Tweak HTML to fit with publish strategy
    html = '<!DOCTYPE html>\r\n<html>\r\n'
          + '  <head>\r\n'
          + `  <link rel="stylesheet" href="_assets/css/default.css">\r\n`
          + `  <link rel="stylesheet" href="_assets/css/user.css">\r\n`
          + `  <link rel="stylesheet" href="_assets/css/global.css">\r\n`
          + '  </head>\r\n'
          + '  <body>\r\n' 
          + html 
          + '\r\n  '
          + '  </body>\r\n'
          + '</html>'
    return html;
  }

  static tweakMD(action, md, pagePath) {
    // Use worldManager.GetRelPath and worldManager.GetFullPathFromRelPath to alter image source for reading or saving the file
    //let worldPath = path.join(configManager.ReadKey('WorldDirectory'),configManager.ReadKey('CurrentWorld')) + path.sep;
    switch (action) {
      case 'read':
        md = md.replace(/(!\[.*?\]\(<)(.*?)(>\))/g,function(match, p1,p2,p3) {
          let fullPathData = worldManager.GetFullPathFromRelPath({
            fromFullPath: pagePath,
            relPath: p2
          });
          if (fullPathData.success) {
            return p1 + 'file:///' + fullPathData.fullPath.replace(/ /g,'%20').replace(/_/g,'\\_') + p3;
          }
          else {
            return match;
          }
        });
        break;
      case 'save':
        // match is the whole matching string, p1 is capture group 1, and p2 is capture group 2, etc.
        md = md.replace(/(!\[.*?\]\(<)(file:\/\/\/)(.*?)(>\))/g,function(match, p1,p2,p3,p4) {
          let relPathData = worldManager.GetRelPath({
            isRelPath: false,
            fromPath: pagePath,
            toPath: p3.replace(/%20/g, ' ').replace(/\\\\_/g,'\\_')
          });
          if (relPathData.success) {
            return p1 + relPathData.relPath.replace(/ /g,'%20') + p4;
          }
          else {
            return match;
          }
        });
        break;
    }
    
    return md;
  }
  static tweakHTML(action, html, pagePath) {
    let basePath = path.join(configManager.ReadKey('WorldDirectory'), configManager.ReadKey('CurrentWorld'));
    let baseImgPath = path.join(basePath, '_web','_assets','images');
    let dom = new jsdom.JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`);
    let jquery = require('jquery')(dom.window);
    let imgs = jquery('img');
    for (let i=0; i<imgs.length; i++) {
      let oldSrc = jquery(imgs[i]).attr('src');
      switch(action) {
        case 'save':
          if (oldSrc.startsWith('file:///' + baseImgPath)) {
            let relData = worldManager.GetRelPath({
              isRelPath: false,
              fromPath: pagePath.replace('file:///',''),
              toPath: oldSrc.replace('file:///','')
            });
            if (relData.success) {
              jquery(imgs[i]).attr('src',relData.relPath);
              jquery(imgs[i]).addClass('image-local');
            }
          }
          break;
        case 'read':
          let relImgPath = '../_web/_assets';
          if (oldSrc.startsWith(relImgPath)) {
            let newSrcData = worldManager.GetFullPathFromRelPath({
              fromFullPath: pagePath,
              relPath: oldSrc
            });
            if (newSrcData.success) {
              jquery(imgs[i]).attr('src','file:///' + newSrcData.fullPath);
              jquery(imgs[i]).addClass('image-local');
            }
          }
          break;
      }
      
    }
    /*
    switch(action) {
      case 'save':
        html = `<!DOCTYPE html><html><head>\r\n`
            + `  <link rel="stylesheet" href="css/default.css">\r\n`
            + `  <link rel="stylesheet" href="css/user.css">\r\n`
            + `</head>\r\n<body>\r\n`
            + fileManager.ReadFileToString(path.join(basePath, 'templates', 'header.html'))
            + jquery('body').html()
            + fileManager.ReadFileToString(path.join(basePath, 'templates', 'footer.html'))
            + `\r\n</body>\r\n</html>`;
        break;
      default:
        html = jquery('body').html();
        break;
    }
    */
    html = jquery('body').html();
    return html;
    
  }

  static GetPagePath(pathInfo) {
    /* pathInfo:
      type
      name
      extension
    */
    /*
    let baseDir = configManager.ReadKey('WorldDirectory');
    let worldDir = path.join(baseDir, configManager.ReadKey('CurrentWorld'));
    let pagePath = '';
    pagePath = path.join(worldDir,'pages',pathInfo.type, pathInfo.name + '.' + pathInfo.extension);
    */
    let pageData = this.GetPageData({
      relPath: pathInfo.relPath,
      fileExt: pathInfo.extension
    });
    if (fs.existsSync(pageData.fullPath)) {
      return {
        success: true,
        path: pageData.fullPath
      };
    }
    else {
      return {
        success: false,
        message: "Unable to find page \"" + pageData.fullPath + "\"."
      };
    }
  }

  static GetPageDataFromNameDisambiguation(nameDisambiguation) {
    let worldData = worldManager.GetWorldData();
    try {
      let thisPage = worldData.pages.filter(function(p) {
        return p.nameDisambiguation==nameDisambiguation;
      });
      let pagePath = this.GetPagePath({
        relPath: thisPage[0].relPath,
        extension: thisPage[0].fileType
      });
      if (thisPage.length==1) {
        return {
          success: true,
          data: thisPage[0],
          pageFullPath: (pagePath && pagePath.success ? pagePath.path : '')
        };
      }
      else if (thisPage.length<1) {
        return {
          success: false,
          message: 'There were no pages named "' + nameDisambiguation + '."'
        }
      }
      else {
        return {
          success: false,
          message: 'World data contains multiple pages named "' + nameDisambiguation + '."'
        };
      }
    }
    catch(e) {
      return {
        success: false,
        message: 'Unable to load world data: ' + e
      };
    }
  }

  static NewPageType(typeName) {
    let baseDir = path.join(configManager.ReadKey('WorldDirectory'),configManager.ReadKey('CurrentWorld'));
    let templateDir = path.join(basDir,'templates');
    let typeTemplatePathNoExt = path.join(templateDir,typeName);
    if (fs.existsSync(templateDir)) {
      
    }
  }

  static GetSaveAsPath() {
    let saveAsOptions = {
      modal: true,
      width: 400,
      height: 125,
      frame: false,
      alwaysOnTop: true,
      webPreferences: {
        preload: path.join(app.getAppPath(), 'src', 'scripts', 'preload.js'),
        nodeIntegration: false, // is default value after Electron v5
        contextIsolation: true, // protect against prototype pollution
        enableRemoteModule: false, // turn off remote
      }
    }
    modal = new BrowserWindow(saveAsOptions);

    var theUrl = 'file://' + path.join(app.getAppPath(), 'src', 'pages', 'modals', 'SaveAsPrompt.html');
    console.log('Modal url', theUrl);
    modal.loadURL(theUrl);
    modal.on('close', function() {
      if (saveAsEvent!=null) {
        saveAsEvent.sender.send('SaveAsPath', {
          'success': false,
          'message': 'File name was not set'
        });
      }
    });
  }

  static SetSaveAsName(event, data) {
    //TODO: Check if file name is acceptable before saving
    let worldPath = configManager.ReadKey('WorldDirectory');
    let currentWorld = configManager.ReadKey('CurrentWorld');
    let savePath = path.join(worldPath, currentWorld, 'pages', data.fileName);
    let saveAs = '';
    if (data.action=='Save') {
      if (data.fileName=='') {
        saveAs = {
          'success': false,
          'message': 'File name was not specified. File has not been saved.'
        };
      }
      else {
        if (fs.existsSync(savePath)) {
          SaveAs = {
            'success': false,
            'message': 'File already exists. File has not been saved.'
          };
        }
        else {
          saveAs = {
            'success': true, 
            'path': savePath,
            'message' : ''
          };
        }
      }
    }
    else {
      saveAs = {
        'success': false,
        'message': ''
      };
    }
    event.sender.send('SaveAsPath', saveAs);
  }

  static DeletePage(pagePath) {   
    /* 
    let worldPath = configManager.ReadKey('WorldDirectory');
    let currentWorld = configManager.ReadKey('CurrentWorld');
    let pagePath = path.join(worldPath, currentWorld, 'pages', pageName);
    */
    let delResult = {
      success: false
    };
    try {
      let pageData = this.GetPageData({
        fullPath : pagePath
      });
      let webDir = path.join(configManager.ReadKey('WorldDirectory'),configManager.ReadKey('CurrentWorld'),'_web',pageData.relPath);
      if (fs.existsSync(webDir)) {
        try {
          fs.rmdirSync(webDir, {recursive: true});
        }
        catch(e) {
          delResult.message += 'Unable to remove _web preview page.\r\n';
        }
      }
      if (fs.existsSync(pagePath)) {
        fs.unlinkSync(pagePath);
        this.RemovePageFromIndex({
          pagePath: pagePath
        });
        delResult.success = true;
      }
      else {
        delResult.success = false;
        delResult.message += 'File "' + pagePath + '" was not found.';
      }
    }
    catch(e) {
      delResult.success = false;
      delResult.message += 'There was a problem deleting the file.<br/>' + e;
    }

    return delResult;
  }

  static RenamePage(pageData) {
    /*
    oldPagePath
    newPageName
    */
    let oldPathData = this.GetPageData({
      fullPath: pageData.oldPagePath
    });
    let newPathData = this.GetPageData({
      fullPath: path.join(oldPathData.basePath,pageData.newPageName + '.' + oldPathData.fileExt)
    });
    
    let newDirParts = newPathData.fullPath.split(path.sep);
    newDirParts.pop();
    let newDir = newDirParts.join(path.sep);
    if (!fs.existsSync(newDir)) {
      fs.mkdirSync(newDir);
    }
    if (fs.existsSync(newPathData.fullPath)) {
      return {
        'success': false,
        'message': 'File "' + newPathData.relPath + '" already exists. Page was not renamed.'
      };
    }
    else {
      let retVal = {
        'success': false,
        'message': '',
        'saveOnReturn': false,
        'newPagePath': newPathData.fullPath,
        'newPageType': newPathData.pageType,
        'newPageName': newPathData.relFileName
      };
      try {
        fs.renameSync(oldPathData.fullPath, newPathData.fullPath, function(err) {
          if (err) {
            retVal.success = false;
            retVal.message = 'Unable to rename ' + oldPathData.relPath + '.<br/>' + err;
            return retVal;
          }
        });
        this.AddPageToIndex(newPathData.fullPath, false);
        this.RemovePageFromIndex({
          pagePath : oldPathData.fullPath
        });

        // Clean up previews        
        if (fs.existsSync(oldPathData.previewPath)) {
          fs.unlinkSync(oldPathData.previewPath);
        }
        let contents = fs.readdirSync(oldPathData.previewDir);
        if (contents.length==0) {
          fs.rmdirSync(oldPathData.previewDir);
        }
        retVal.success=true;
      }
      catch(e) {
        retVal.success = false;
        retVal.message += 'Unable to save file.<br/>' + e;
        retVal.saveOnReturn = false;
        return retVal;
      }
      return retVal;
    }
  }

  static NewPage(event) {
    switch(configManager.ReadUserPref('editorStyle'))
    {
      case 'MD':
        event.sender.send('navigate',path.join(app.getAppPath(), 'src','edit.html'));
        break;
      default: //RTE
        event.sender.send('navigate',path.join(app.getAppPath(), 'src','rtedit.html'));
        break;
    }
  }
  static Convert(event, pageData) {
    if (pageData && pageData.oldFileType=='md' && pageData.newFileType=='html') {
      let getPagePath = this.GetPagePath({
        relPath : path.join(pageData.type, pageData.name),
        extension : pageData.oldFileType
      });
      if (getPagePath.success) {
        let pagePathParts = getPagePath.path.split('.');
        let oldExt = pagePathParts.pop();
        let newPagePath = pagePathParts.join('.') + '.html';
        try {
          fs.renameSync(getPagePath.path, newPagePath, function(err) {
            if (err) {
              retVal.success = false;
              retVal.message = 'Unable to convert ' + getPagePath.path + '.<br/>' + err;
              return retVal;
            }
          });
          fs.writeFileSync(newPagePath, this.tweakHTML('save', pageData.htmlContent, newPagePath));
          this.AddPageToIndex(newPagePath, true);
          return {
            success: true,
            newPath: newPagePath
          };
        }
        catch(e) {
          return {
            success: false,
            message: 'Unable to convert page. ' + e
          };
        }
      }
    }
    else if (pageData && pageData.oldFileType=='html' && pageData.newFileType=='md') {
      let getPagePath = this.GetPagePath({
        relPath : path.join(pageData.type, pageData.name),
        extension : pageData.oldFileType
      });
      if (getPagePath.success) {
        let pagePathParts = getPagePath.path.split('.');
        let oldExt = pagePathParts.pop();
        let newPagePath = pagePathParts.join('.') + '.md';
        try {
          fs.renameSync(getPagePath.path, newPagePath, function(err) {
            if (err) {
              retVal.success = false;
              retVal.message = 'Unable to convert ' + getPagePath.path + '.<br/>' + err;
              return retVal;
            }
          });
          fs.writeFileSync(newPagePath, this.tweakMD('save',pageData.mdContent,newPagePath));
          this.AddPageToIndex(newPagePath, true);
          return {
            success: true,
            newPath: newPagePath
          };
        }
        catch(e) {
          return {
            success: false,
            message: 'Unable to convert page. ' + e
          };
        }
      }
    }
    else {
      return {
        success: false,
        message: 'Unable to convert page.'
      };
    }
  }

  static GetPageData(pathInfo) {
    /* pathInfo:
      fullPath (string) (optional)
      relPath (string) (optional)
    */
    let pathData = {
      success : false,
      fullPath : '',
      relPath : '',
      fileExt : '',
      fileName : '',
      relFileName : '',
      pageType : '',
      basePath : '',
      previewDir : '',
      previewPath : ''
    };
    if ((!pathInfo.fullPath || pathInfo.fullPath=='') && (pathInfo.relPath && pathInfo.relPath!='')) {
      pathInfo.fullPath = path.join(configManager.ReadKey('WorldDirectory'), configManager.ReadKey('CurrentWorld'),'pages',pathInfo.relPath + '.' + pathInfo.fileExt);
    }
    if (pathInfo.fullPath && pathInfo.fullPath!='') {
      pathData.fullPath = pathInfo.fullPath;
      let worldPath = configManager.ReadKey('WorldDirectory');
      let currentWorld = configManager.ReadKey('CurrentWorld');
      pathData.basePath = path.join(worldPath,currentWorld,'pages');
      let basePathParts = pathData.basePath.split(path.sep);
      let fullPathParts = pathInfo.fullPath.split(path.sep);
      let relPathParts = [];
      for (let i=basePathParts.length; i<fullPathParts.length; i++) {
        if (i==fullPathParts.length-1) {
          pathData.fileName = fullPathParts[i];
          let fileNameParts = pathData.fileName.split('.');
          pathData.fileExt = fileNameParts.pop();
          pathData.relFileName = '';
          for (let j=0; j<fileNameParts.length; j++) {
            pathData.relFileName += fileNameParts[j] + (j==fileNameParts.length-1 ? '' : '.');
          }
          pathData.relPath = path.join(pathData.relPath, pathData.relFileName);
          relPathParts.push(pathData.relFileName);
        }
        else {
          pathData.relPath = path.join(pathData.relPath, fullPathParts[i]);
          relPathParts.push(fullPathParts[i]);
        }
      }
    
    
    
      for (let i=0; i<relPathParts.length-1; i++) {
        pathData.pageType = path.join(pathData.pageType,relPathParts[i]);
      }

      pathData.previewDir = path.join(worldPath, currentWorld, '_web',pathData.relPath);
      pathData.previewPath = path.join(pathData.previewDir, 'index.html');

      pathData.success = true;
    }
    else {
      pathData.success = false;
      pathData.message = 'Please specify either a relPath or a fullPath.';
    }
  
    return pathData;
  
}



}