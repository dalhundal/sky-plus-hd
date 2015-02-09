Sky Region Codes
================

To produce this list, you can run this Javascript code on http://tv.sky.com/tv-guide

    JSON.stringify(function() {
        var regionsIndexed = {};
        $('a[data-region]').each(function() {
            $this = $(this);
            var nameFull = $this.text();
            var nameMatches = nameFull.match(/(.*?) (hd|sd)/i);
            var regionName = nameMatches[1];
            var slugName = regionName.toLowerCase().replace(/[^a-zA-Z0-9_]+/g,'-')
            var isHD = nameMatches[2]==='HD';
            if (!regionsIndexed[slugName]) {
                regionsIndexed[slugName] = {name: regionName}
            };
            regionsIndexed[slugName][isHD?'hd':'sd'] = $this.attr('data-region');
        });
        return regionsIndexed;
    }());
