'use strict';

var express = require('express')
  , app = module.exports = express()
  , fs = require('fs')
  , path = require('path')
  , md = require('./markdown-it.js').md
  , temp = require('temp')
  , phantom = require('phantom')
  , breakdance = require('breakdance')
  , pandoc = require('node-pandoc')
  , gutil = require('gulp-util')
  , util = require('util')
  ;

const phantomSession = phantom.create()

function getPhantomSession() { return phantomSession }

function _getFullHtml(name, str, style) {
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>'
    + name + '</title><style>'
    + ((style) ? style : '') + '</style></head><body id="preview">\n'
    + md.render(str) + '\n</body></html>';
}

function _getHtml(str) { return md.render(str) }

// Move this into _getFormat() to reload the CSS without restarting node.
var _format = fs.readFileSync(path.resolve(__dirname, '../../public/css/app.css')).toString('utf-8');

function _getFormat() {
  return _format;
}

var fetchMd = function (req, res) {
  var unmd = req.body.unmd
    , json_response =
      {
        data: ''
        , error: false
      }

  var name = req.body.name.trim()

  if (!name.includes('.md')) {
    name = name + '.md'
  }

  if (req.body.preview === 'false') {
    res.attachment(name);
  } else {
    // We don't use text/markdown because my "favorite" browser
    // (IE) ignores the Content-Disposition: inline; and prompts
    // the user to download the file.
    res.type('text');

    // For some reason IE and Chrome ignore the filename
    // field when Content-Type: text/plain;
    res.set('Content-Disposition', `inline; filename="${name}"`);
  }

  res.end(unmd);
}

var fetchHtml = function (req, res) {
  var unmd = req.body.unmd
    , json_response =
      {
        data: ''
        , error: false
      }

  // For formatted HTML or not...
  var format = req.body.formatting ? _getFormat() : "";

  var html = _getFullHtml(req.body.name, unmd, format);

  var name = req.body.name.trim() + '.html'

  var filename = path.resolve(__dirname, '../../downloads/files/html/' + name)

  if (req.body.preview === 'false') {
    res.attachment(name);
  } else {
    res.type('html');
    res.set('Content-Disposition', `inline; filename="${name}"`);
  }

  res.end(html);
}

var fetchPdf = function (req, res) {
  var unmd = req.body.unmd
    , json_response =
      {
        data: ''
        , error: false
      }

  var html = _getFullHtml(req.body.name, unmd, _getFormat())
  var tempPath = temp.path({ suffix: '.htm' })
  fs.writeFile(tempPath, html, 'utf8', function fetchPdfWriteFileCb(err, data) {
    if (err) {
      console.error(err);
      res.end("Something wrong with the pdf conversion.");
    } else {
      _createPdf(req, res, tempPath);
    }
  });
}

function _createPdf(req, res, tempFilename) {
  getPhantomSession().then(phantom => {
    return phantom.createPage();
  }).then(page => {
    page.open(tempFilename).then(status => {
      _renderPage(page);
    });
  });

  function _renderPage(page) {
    var name = req.body.name.trim() + '.pdf'
    var filename = temp.path({ suffix: '.pdf' })

    page.property('paperSize', { format: 'A4', orientation: 'portrait', margin: '1cm' })
    page.property('viewportSize', { width: 1024, height: 768 })

    page.render(filename).then(function () {
      if (req.body.preview === 'false') {
        res.attachment(name)
      } else {
        res.type('pdf')
        res.set('Content-Disposition', `inline; filename="${name}"`)
      }

      res.sendFile(filename, {}, function () {
        // Cleanup.
        fs.unlink(filename)
        fs.unlink(tempFilename)
      });

      page.close()
    });
  }
}

// Convert HTML to MD
function htmlToMd(req, res) {

  var md = ''

  try {
    md = breakdance(req.body.html)
  } catch (e) {
    return res.status(400).json({ error: { message: 'Something went wrong with the HTML to Markdown conversion.' } })
  }

  return res.status(200).json({ convertedMd: md })

}

// Convert Markdown to MediaWiki using Pandoc
var fetchMediaWiki = function (req, res) {
  var unmd = req.body.unmd
    , json_response =
      {
        data: ''
        , error: false
      }

  // Store MD as file
  var srcTmpPath = temp.path({ suffix: '.md' });
  var srcFile = fs.writeFile(srcTmpPath, unmd, 'utf8', function cb(err, data) {
    if (err) {
      console.error(err);
      res.end("Failed to write to tempfile");
    }
  });

  // Convert to new file
  var tempPath = temp.path({ suffix: '.mediawiki' });
  gutil.log(gutil.colors.yellow('PANDOC out=') + tempPath);

  pandoc(srcTmpPath, '-f markdown -t mediawiki -s -o ' + tempPath, function (err, result) {
    if (err || !result) {
      gutil.log(gutil.colors.red('PANDOC ERROR ') + err);
      res.end("Failed to perform Pandoc conversion");
    } else {
      gutil.log(gutil.colors.blue('FILE SIZE: ') + fs.statSync(tempPath).size);
      getPhantomSession().then(phantom => {
        return phantom.createPage();
      }).then(page => {
        page.open(tempPath).then(status => {
          if (req.body.preview === 'false') {
            res.download(tempPath);
          } else {
            res.type('text/plain');
            res.set('Content-Disposition', 'inline; filename="${tempPath}"');
            res.set('X-Content-Type-Options', 'nosniff');
            res.sendFile(tempPath, {}, function () {
              // Cleanup.
              fs.unlink(tempPath);
              fs.unlink(srcTmpPath);
            });
          }
        });
      });
    }
  });
}

/* Start Dillinger Routes */

// Download a markdown file directly as response.
app.post('/factory/fetch_markdown', fetchMd)

// Download an html file directly as response.
app.post('/factory/fetch_html', fetchHtml)

// Download a pdf file directly as response.
app.post('/factory/fetch_pdf', fetchPdf)

// Download a pdf file directly as response.
app.post('/factory/html_to_md', htmlToMd)

// Download a MediaWiki file directly as response.
app.post('/factory/fetch_mediawiki', fetchMediaWiki)

/* End Dillinger Core */
