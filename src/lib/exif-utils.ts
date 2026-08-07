
import EXIF from 'exif-js';

export interface ImageMetadata {
  lat?: number;
  lng?: number;
  altitude?: number;
  date?: string;
  make?: string;
  model?: string;
}

export function extractMetadata(file: File): Promise<ImageMetadata> {
  return new Promise((resolve) => {
    EXIF.getData(file as any, function (this: any) {
      const allMetaData = EXIF.getAllTags(this);
      
      let lat = undefined;
      let lng = undefined;
      
      if (allMetaData.GPSLatitude && allMetaData.GPSLatitudeRef) {
        const latRef = allMetaData.GPSLatitudeRef;
        const latDeg = allMetaData.GPSLatitude[0];
        const latMin = allMetaData.GPSLatitude[1];
        const latSec = allMetaData.GPSLatitude[2];
        lat = (latDeg + latMin / 60 + latSec / 3600) * (latRef === 'N' ? 1 : -1);
      }
      
      if (allMetaData.GPSLongitude && allMetaData.GPSLongitudeRef) {
        const lngRef = allMetaData.GPSLongitudeRef;
        const lngDeg = allMetaData.GPSLongitude[0];
        const lngMin = allMetaData.GPSLongitude[1];
        const lngSec = allMetaData.GPSLongitude[2];
        lng = (lngDeg + lngMin / 60 + lngSec / 3600) * (lngRef === 'E' ? 1 : -1);
      }

      resolve({
        lat,
        lng,
        altitude: allMetaData.GPSAltitude,
        date: allMetaData.DateTimeOriginal || allMetaData.DateTime,
        make: allMetaData.Make,
        model: allMetaData.Model
      });
    });
  });
}
