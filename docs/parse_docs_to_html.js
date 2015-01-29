// parses the bindings code and plask.js and produces and html file with
// reference documentation from markdown in the code comments.
var fs = require('fs');
var markdown = require('./markdown.js');

var header = fs.readFileSync(__dirname + '/header.html', 'utf8');
var footer = fs.readFileSync(__dirname + '/footer.html', 'utf8');

var webgl1_idl = fs.readFileSync(__dirname + '/webgl.idl', 'utf8');
var webgl2_idl = fs.readFileSync(__dirname + '/webgl2.idl', 'utf8');

function htmlescape(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function parse_source_cpp(lines, cb_continue, cb_start, cb_end) {
  var cur_class = null;
  var cur_indent = null;
  var cur_method = null;
  var cur_arity = undefined;
  var cur_cmt = '';

  for (var i = 0, il = lines.length; i < il; ++i) {
    var line = lines[i];

    var match;

    var prev_cmt = cur_cmt;

    match = line.match(/^\s*\/\/ ?(.*)$/);
    if (match) {
      cur_cmt += match[1] + '\n';
    } else {
      cur_cmt = '';
    }

    match = line.match(/^class ([A-Za-z_0-9]+)/);
    if (match) {
      cur_class = match[1];
      cb_continue(line);
      continue;
    }

    if (cur_class === null) {
      cb_continue(line);
      continue;
    }

    match = line.match(/^(\s*)(static void ([A-Za-z_0-9]+)\(const v8::FunctionCallbackInfo<v8::Value>& args\)|DEFINE_METHOD\(([A-Za-z_0-9]+), (\d+))/);
    if (match) {
      cur_indent = match[1];
      cur_method = match[3] || match[4];
      cur_arity = match[5];
      cb_start(line, cur_indent, cur_class, cur_method, cur_arity, prev_cmt);
      continue;
    }

    if (cur_indent === null) {
      cb_continue(line);
      continue;
    }

    match = line.match(/args\[(\d+)\]/);
    if (match) {
      var arity = parseInt(match[1]) + 1;
      if (cur_arity === undefined || arity > cur_arity)
        cur_arity = arity;
      cb_continue(line);
      continue;
    }

    match = line.match(/^(\s*)}/);
    if (match && match[1] === cur_indent) {
      cur_indent = null;
      cb_end(line, cur_class, cur_method, arity);
      continue;
    }

    cb_continue(line);
  }
}

function parse_source_js(lines, cb_continue, cb_start, cb_end, cb_export) {
  var cur_class = null;
  var cur_indent = null;
  var cur_method = null;
  var cur_arity = undefined;
  var cur_cmt = '';

  for (var i = 0, il = lines.length; i < il; ++i) {
    var line = lines[i];

    var match;

    var prev_cmt = cur_cmt;

    match = line.match(/^\s*\/\/ ?(.*)$/);
    if (match) {
      cur_cmt += match[1] + '\n';
    } else {
      cur_cmt = '';
    }

    match = line.match(/^(\s*)exports.([A-Za-z_0-9]+) = ([A-Za-z_0-9]+);/);
    if (match) {
      cur_indent = match[1];
      cur_lhs    = match[2];
      cur_rhs    = match[2];
      cb_export(line, cur_indent, cur_lhs, cur_rhs);
      continue;
    }

    match = line.match(/^(\s*)function ([A-Za-z_0-9]+)\(/);
    if (match) {
      cur_indent = match[1];
      cur_class  = match[2];
      cur_method = match[2];
      cb_start(line, cur_indent, cur_class, cur_method, cur_arity, prev_cmt);
      continue;
    }

    match = line.match(/^(\s*)([A-Za-z_0-9]+)(?:\.prototype)?\.([A-Za-z_0-9]+) = function/);
    if (match) {
      cur_indent = match[1];
      cur_class  = match[2];
      cur_method = match[3];
      cb_start(line, cur_indent, cur_class, cur_method, cur_arity, prev_cmt);
      continue;
    }

    if (cur_indent === null) {
      cb_continue(line);
      continue;
    }

    cb_continue(line);
  }
}

var functions = [ ];
var jsexports = [ ];

function make_md(meth, cmt) {
  if (cmt.length === 0) '### ' + meth + "\n";

  cmt = cmt.replace(/^(TODO|FIXME|NOTE).*$/mg, '');

  var headi = cmt.indexOf('\n\n');
  if (headi === -1) headi = cmt.length;
  var head = cmt.substr(0, headi), tail = cmt.substr(headi);
  //console.log([head, tail]);

  // We sort of assume the structure of a first line with a function prototype,
  // but that isn't always true (yet).
  if (head.indexOf(meth) !== -1) {
    head = head.replace(/^/mg, '    ');  // Turn into a code block.
  }

  cmt = head + "\n\n" + tail;

  return '### ' + meth + "\n" + cmt;
}

var lines_cpp = fs.readFileSync(__dirname + '/../plask_bindings.mm', 'utf8').split('\n');
var lines_js  = fs.readFileSync(__dirname + '/../plask.js', 'utf8').split('\n');

parse_source_cpp(lines_cpp, function() { },
  function(line, indent, cls, meth, arity, cmt) {
    var md = markdown.parse(make_md(meth.replace('V8New', cls.replace(/Wrapper/g, '')), cmt));
    var html = markdown.toHTML(md, {xhtml:true}) + "\n";
    functions.push({cls: cls, meth: meth, html: html});
  },
  function(line, cls, meth, arity) {
  });

//functions = [ ];
parse_source_js(lines_js, function() { },
  function(line, indent, cls, meth, arity, cmt) {
    var md = markdown.parse(make_md(meth, cmt));
    var html = markdown.toHTML(md, {xhtml:true}) + "\n";
    functions.push({cls: cls, meth: meth, html: html});
  },
  function(line, cls, meth, arity) {
  },
  function(line, indent, lhs, rhs) {
    jsexports.push(lhs);
  });

function sorter(a, b) {
  if (a.cls === b.cls) return a.meth.localeCompare(b.meth);
  return a.cls.localeCompare(b.cls);
}

// Rewrite some of the small "loose" functions to be under 'plask'.
for (var i = 0, il = functions.length; i < il; ++i) {
  var f = functions[i];
  if (f.cls[0].toLowerCase() === f.cls[0] && f.meth === f.cls && jsexports.indexOf(f.meth) !== -1)
    f.cls = "plask";
}

functions.sort(sorter);

var last_cls = null;

console.log(header);

var kIncludeCls = ['AVPlayerWrapper', 'NSOpenGLContextWrapper', 'NSWindowWrapper',
                   'SkCanvasWrapper', 'SkPaintWrapper', 'SkPathWrapper',
                   'MagicProgram', 'Mat3', 'Mat4', 'Vec2', 'Vec3', 'Vec4', 'plask'];

for (var i = 0, il = functions.length; i < il; ++i) {
  var f = functions[i];

  if (kIncludeCls.indexOf(f.cls) === -1) {
    process.stderr.write("Skipping: " + f.cls + "\n");
    continue;
  }

  if (f.cls !== last_cls) {
    var clsdisp = f.cls.replace(/Wrapper/g, '');
    if (clsdisp === "MagicProgram") clsdisp = "gl." + clsdisp;
    console.log('<h1>' + clsdisp + '</h1>');
    last_cls = f.cls;
  }

  var html = f.html;

  var link = null;

  if (f.cls === "NSOpenGLContextWrapper") {
    var rx = new RegExp('^.*\\b' + f.meth + '\\([^;]+;', 'mg');
    var glver = '1.0';
    var match = webgl1_idl.match(rx);
    if (!match) {
      var glver = '2.0';
      match = webgl2_idl.match(rx);
    }

    if (match) {
      var url = 'https://www.khronos.org/registry/webgl/specs/latest/' + glver + '/';
      link = '<a href="' + url + '">WebGL ' + glver + '</a>';
      //console.log('<pre>' + htmlescape(match[0]) + '</pre>');
    }
  }

  if (f.cls === "AVPlayerWrapper") {
    var m = f.meth;
    if (m.substr(0, 3) === "set") m = m.substr(3, 1).toLowerCase() + m.substr(4);
    var url = 'https://developer.apple.com/library/mac/documentation/AVFoundation/Reference/AVPlayer_Class/index.html#//apple_ref/occ/instm/AVPlayer/' + m;
    link = '<a href="' + url + '">AVPlayer</a>';

  }

  if (f.cls === "NSEventWrapper") {
    var m = f.meth;
    if (m.substr(0, 3) === "set") m = m.substr(3, 1).toLowerCase() + m.substr(4);
    var url = 'https://developer.apple.com/library/mac/documentation/Cocoa/Reference/ApplicationKit/Classes/NSEvent_Class/#//apple_ref/occ/instm/NSEvent/' + m;
    link = '<a href="' + url + '">NSEvent</a>';
  }

  if (m === 'V8New') link = null;

  if (link !== null) {
    link = '<span class="gllink">[' + link + ']</span>';
    html = html.replace('</h3>', link + '</h3>');
  }

  html = html.replace('</h3>\n\n<pre><code>', '</h3>\n\n<pre class="proto"><code>');
  html = html.replace('</h3>', '</h3>\n<div class="fbody">') + '</div>';

  console.log(html);
}

console.log(footer);