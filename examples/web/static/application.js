var socket = io.connect('http://b5.dalhundal.com');
socket.on('change', function (change) {
   processChange(change);
});
socket.on('changes',function(changes) {
   $('tbody.changes').empty();
   _.each(changes,function(change) {
      processChange(change);
   });
})

var makeEl = function(tagName,attributes,content) {
   var el = document.createElement(tagName);
   //
   if (attributes) for (var i in attributes) {
      j = (i=='className') ? 'class' : i;
      el.setAttribute(j, attributes[i]);
   };
   //
   if (content) {
      if (!_.isArray(content)) content = [content];
      for (var i in content) {
         if (_.isString(content[i])) {
            el.appendChild(document.createTextNode(content[i]));
         } else if (content[i] instanceof HTMLElement) {
            el.appendChild(content[i]);
         } else if (content[i] instanceof jQuery) {
            content[i].each(function(j,k) {
               el.appendChild(k);
            });
         };
      };
   };
   return el;
}

var processChange = function(change) {
   var el = createChangeHTML(change);
   $('tbody.changes').prepend(el);
}

var createChangeHTML = function (change) {
   var el = makeEl('tr',{className:'change'},[
      makeEl('td',{},""+new Date(change.ts).toString()),
      makeEl('td',{},""+change.data.channel.channel),
      makeEl('td',{},change.data.channel.name),
      makeEl('td',{},change.data.program.now.title),
      makeEl('td',{},makeEl('a',{href:change.data.program.now.url},change.data.program.now.url)),
      makeEl('td',{},(change.data.program.now.image) ? makeEl('img',{src:change.data.program.now.image}) : '')
   ]);
   return el;
}