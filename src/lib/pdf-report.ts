import { jsPDF } from 'jspdf';
import { ImageMetadata } from './exif-utils';

export async function generateReport(
  originalSrc: string,
  processedSrc: string,
  metadata: ImageMetadata,
  filterName: string,
  intensity: number,
  imageWidth: number,
  imageHeight: number
) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // Settings
  const primaryColor = [55, 42, 32]; // #372A20
  const serifFont = 'times';

  // Header - Center Title
  doc.setFont(serifFont, 'bold');
  doc.setFontSize(24);
  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.text('OpuntiaColor', pageWidth / 2, 25, { align: 'center' });
  
  doc.setFont(serifFont, 'italic');
  doc.setFontSize(14);
  doc.text('Advanced Archaeological Rock Art Report v3.4.0', pageWidth / 2, 35, { align: 'center' });

  doc.setDrawColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.setLineWidth(0.5);
  doc.line(40, 40, pageWidth - 40, 40);

  // Metadata Section
  doc.setFont(serifFont, 'bold');
  doc.setFontSize(12);
  doc.text('Technical Metadata', pageWidth / 2, 55, { align: 'center' });
  
  doc.setFont(serifFont, 'normal');
  doc.setFontSize(10);
  const metaY = 65;
  doc.text(`Location: ${metadata.lat ? `${metadata.lat.toFixed(6)}, ${metadata.lng?.toFixed(6)}` : 'N/A'}`, pageWidth / 2, metaY, { align: 'center' });
  doc.text(`Altitude: ${metadata.altitude ? `${metadata.altitude}m` : 'N/A'}`, pageWidth / 2, metaY + 7, { align: 'center' });
  doc.text(`Original Capture: ${metadata.date || 'Unknown'}`, pageWidth / 2, metaY + 14, { align: 'center' });
  doc.text(`Equipment: ${metadata.make || ''} ${metadata.model || ''}`, pageWidth / 2, metaY + 21, { align: 'center' });

  // Filter Info
  doc.setFont(serifFont, 'bold');
  doc.text('Enhancement Settings', pageWidth / 2, metaY + 35, { align: 'center' });
  doc.setFont(serifFont, 'normal');
  doc.text(`Filter: ${filterName} | Intensity: ${intensity.toFixed(1)}x`, pageWidth / 2, metaY + 42, { align: 'center' });

  // Images - Scaling calculation
  const aspectRatio = imageWidth / imageHeight;
  const maxImgWidth = (pageWidth / 2) - 20;
  const maxImgHeight = 70;

  let finalImgWidth = maxImgWidth;
  let finalImgHeight = finalImgWidth / aspectRatio;

  if (finalImgHeight > maxImgHeight) {
    finalImgHeight = maxImgHeight;
    finalImgWidth = finalImgHeight * aspectRatio;
  }

  const imgY = metaY + 60;

  doc.setFont(serifFont, 'bold');
  doc.setFontSize(11);
  
  const leftCenter = 15 + (finalImgWidth / 2);
  const rightCenter = pageWidth - 15 - (finalImgWidth / 2);

  doc.text('Original Image', leftCenter, imgY - 5, { align: 'center' });
  doc.addImage(originalSrc, 'JPEG', 15, imgY, finalImgWidth, finalImgHeight);

  doc.text('Enhanced Image', rightCenter, imgY - 5, { align: 'center' });
  doc.addImage(processedSrc, 'PNG', pageWidth - finalImgWidth - 15, imgY, finalImgWidth, finalImgHeight);

  // Footer - Institutional Credits
  const footerY = pageHeight - 25;
  doc.setFont(serifFont, 'normal');
  doc.setFontSize(7);
  doc.setTextColor(120, 120, 120);
  
  doc.text('Dr. Emilio A. Villafañez · LATDAA · Fund. Félix de Azara · Universidad Nacional de Catamarca (UNCA), Argentina', pageWidth / 2, footerY, { align: 'center' });
  
  doc.setFont(serifFont, 'bold');
  doc.text('OpuntiaColor v3.4.0 • 2024', pageWidth / 2, footerY + 5, { align: 'center' });

  doc.save(`Opuntia_Report_${Date.now()}.pdf`);
}
