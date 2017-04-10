/*global define, window */
/*
Global Map Tiles as defined in Tile Map Service (TMS) Profiles
==============================================================

Functions necessary for generation of global tiles used on the web.
It contains classes implementing coordinate conversions for:

  - GlobalMercator (based on EPSG:900913 = EPSG:3785)
       for Google Maps, Yahoo Maps, Microsoft Maps compatible tiles
  - GlobalGeodetic (based on EPSG:4326)
       for OpenLayers Base Map and Google Earth compatible tiles

More info at:

    http://wiki.osgeo.org/wiki/Tile_Map_Service_Specification
    http://wiki.osgeo.org/wiki/WMS_Tiling_Client_Recommendation
    http://msdn.microsoft.com/en-us/library/bb259689.aspx
    http://code.google.com/apis/maps/documentation/overlays.html#Google_Maps_Coordinates

Created by Klokan Petr Pridal on 2008-07-03.
Google Summer of Code 2008, project GDAL2Tiles for OSGEO.

In case you use this class in your product, translate it to another language
or find it usefull for your project please let me know.
My email: klokan at klokan dot cz.
I would like to know where it was used.

Class is available under the open-source GDAL license (www.gdal.org).
 """

import math

class GlobalMercator(object):
     """
    TMS Global Mercator Profile
    ---------------------------

    Functions necessary for generation of tiles in Spherical Mercator projection,
    EPSG:900913 (EPSG:gOOglE, Google Maps Global Mercator), EPSG:3785, OSGEO:41001.

    Such tiles are compatible with Google Maps, Microsoft Virtual Earth, Yahoo Maps,
    UK Ordnance Survey OpenSpace API, ...
    and you can overlay them on top of base maps of those web mapping applications.
    
    Pixel and tile coordinates are in TMS notation (origin [0,0] in bottom-left).

    What coordinate conversions do we need for TMS Global Mercator tiles::

         LatLon      <->       Meters      <->     Pixels    <->       Tile     

     WGS84 coordinates   Spherical Mercator  Pixels in pyramid  Tiles in pyramid
         lat/lon            XY in metres     XY pixels Z zoom      XYZ from TMS 
    EPSG:4326           EPSG:900913                                         
         .----.              ---------               --                TMS      
        /      \     <->     |       |     <->     /----/    <->      Google    
        \      /             |       |           /--------/          QuadTree   
         -----               ---------         /------------/                   
       KML, public         WebMapService         Web Clients      TileMapService

    What is the coordinate extent of Earth in EPSG:900913?

      [-20037508.342789244, -20037508.342789244, 20037508.342789244, 20037508.342789244]
      Constant 20037508.342789244 comes from the circumference of the Earth in meters,
      which is 40 thousand kilometers, the coordinate origin is in the middle of extent.
      In fact you can calculate the constant as: 2 * math.pi * 6378137 / 2.0
      $ echo 180 85 | gdaltransform -s_srs EPSG:4326 -t_srs EPSG:900913
      Polar areas with abs(latitude) bigger then 85.05112878 are clipped off.

    What are zoom level constants (pixels/meter) for pyramid with EPSG:900913?

      whole region is on top of pyramid (zoom=0) covered by 256x256 pixels tile,
      every lower zoom level resolution is always divided by two
      initialResolution = 20037508.342789244 * 2 / 256 = 156543.03392804062

    What is the difference between TMS and Google Maps/QuadTree tile name convention?

      The tile raster itself is the same (equal extent, projection, pixel size),
      there is just different identification of the same raster tile.
      Tiles in TMS are counted from [0,0] in the bottom-left corner, id is XYZ.
      Google placed the origin [0,0] to the top-left corner, reference is XYZ.
      Microsoft is referencing tiles by a QuadTree name, defined on the website:
    http://msdn2.microsoft.com/en-us/library/bb259689.aspx

    The lat/lon coordinates are using WGS84 datum, yeh?

      Yes, all lat/lon we are mentioning should use WGS84 Geodetic Datum.
      Well, the web clients like Google Maps are projecting those coordinates by
      Spherical Mercator, so in fact lat/lon coordinates on sphere are treated as if
      the were on the WGS84 ellipsoid.
     
      From MSDN documentation:
      To simplify the calculations, we use the spherical form of projection, not
      the ellipsoidal form. Since the projection is used only for map display,
      and not for displaying numeric coordinates, we don't need the extra precision
      of an ellipsoidal projection. The spherical projection causes approximately
      0.33 percent scale distortion in the Y direction, which is not visually noticable.

    How do I create a raster in EPSG:900913 and convert coordinates with PROJ.4?

      You can use standard GIS tools like gdalwarp, cs2cs or gdaltransform.
      All of the tools supports -t_srs 'epsg:900913'.

      For other GIS programs check the exact definition of the projection:
      More info at http://spatialreference.org/ref/user/google-projection/
      The same projection is degined as EPSG:3785. WKT definition is in the official
      EPSG database.

      Proj4 Text:
        +proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0
        +k=1.0 +units=m +nadgrids=@null +no_defs

      Human readable WKT format of EPGS:900913:
         PROJCS["Google Maps Global Mercator",
             GEOGCS["WGS 84",
                 DATUM["WGS_1984",
                     SPHEROID["WGS 84",6378137,298.2572235630016,
                         AUTHORITY["EPSG","7030"]],
                     AUTHORITY["EPSG","6326"]],
                 PRIMEM["Greenwich",0],
                 UNIT["degree",0.0174532925199433],
                 AUTHORITY["EPSG","4326"]],
             PROJECTION["Mercator_1SP"],
             PARAMETER["central_meridian",0],
             PARAMETER["scale_factor",1],
             PARAMETER["false_easting",0],
             PARAMETER["false_northing",0],
             UNIT["metre",1,
                 AUTHORITY["EPSG","9001"]]]
*/


function MercatorUtils () {


    "use strict";


    var tileSize = 256,
        initialResolution = 2 * Math.PI * 6378137 / tileSize,
        originShift = 2 * Math.PI * 6378137 / 2,


        mercator = {


            tileSize: tileSize,


            // Resolution (meters/pixel) for given zoom level (measured at Equator)
            resolution: function (zoom) {
                return initialResolution / Math.pow(2, zoom);
            },


            // Zoom level for given resolution (measured at Equator)
            zoom: function (resolution) {
                return Math.round(Math.log(initialResolution / resolution) / Math.log(2));
            },


            // Converts given lat/lon in WGS84 Datum to XY in Spherical Mercator EPSG:900913
            latLonToMeters: function (lat, lon) {
                var mx = lon * originShift / 180,
                    my = Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180);
                my = my * originShift / 180;
                return [mx, my];
            },


            // Converts XY point from Spherical Mercator EPSG:900913 to lat/lon in WGS84 Datum
            metersToLatLon: function (mx, my) {
                var lon = (mx / originShift) * 180,
                    lat = (my / originShift) * 180;
                lat = 180 / Math.PI * (2 * Math.atan(Math.exp(lat * Math.PI / 180)) - Math.PI / 2);
                return [lat, lon];
            },


            // Converts pixel coordinates in given zoom level of pyramid to EPSG:900913
            pixelsToMeters: function (px, py, zoom) {
                var res = mercator.resolution(zoom),
                    x = px * res - originShift,
                    y = py * res - originShift;
                return [x, y];
            },


            // Converts EPSG:900913 to pixel coordinates in given zoom level
            metersToPixels: function (mx, my, zoom) {
                var res = mercator.resolution(zoom),
                    x = (mx + originShift) / res,
                    y = (my + originShift) / res;
                return [x, y];
            },

            // Converts given lat/lon in WGS84 Datum to pixel coordinates in given zoom level
            latLonToPixels: function (lat, lon, zoom) {
                var meters = mercator.latLonToMeters(lat, lon);
                return mercator.metersToPixels(meters[0], meters[1], zoom);
            },

            // Converts pixel coordinates in given zoom level to lat/lon in WGS84 Datum
            pixelsToLatLon: function (px, py, zoom) {
                var meters = mercator.pixelsToMeters(px, py, zoom);
                return mercator.metersToLatLon(meters[0], meters[1]);
            },

            // Returns a tile covering region in given pixel coordinates
            pixelsToTile: function (px, py) {
                return [Math.floor(px / tileSize), Math.floor(py / tileSize)];
            },


            // Returns tile for given mercator coordinates
            metersToTile: function (mx, my, zoom) {
                var pixels = mercator.metersToPixels(mx, my, zoom);
                return mercator.pixelsToTile(pixels[0], pixels[1]);
            },


            // Returns bounds of the given tile in EPSG:900913 coordinates
            tileBounds: function (tx, ty, zoom) {
                var min = mercator.pixelsToMeters(tx * tileSize, ty * tileSize, zoom),
                    max = mercator.pixelsToMeters((tx + 1) * tileSize, (ty + 1) * tileSize, zoom);
                return min.concat(max);
            },


            // Returns bounds of the given tile in latutude/longitude using WGS84 datum
            tileLatLonBounds: function (tx, ty, zoom) {
                var bounds = mercator.tileBounds(tx, ty, zoom),
                    min = mercator.metersToLatLon(bounds[0], bounds[1]),
                    max = mercator.metersToLatLon(bounds[2], bounds[3]);
                return min.concat(max);
            },


            tilePixelBounds: function (tx, ty, zoom) {
                var bounds = mercator.tileBounds(tx, ty, zoom),
                    min = mercator.metersToPixels(bounds[0], bounds[1], zoom),
                    max = mercator.metersToPixels(bounds[2], bounds[3], zoom);
                return min.concat(max);
            }
        };

       
    return mercator;

};

var mercator = MercatorUtils();