/**
 * SemiLightroom - 16-bit Lossless TIFF & 16-bit Adobe DNG Master Exporter
 * 16-bit per channel (65,536 levels) Studio Master Output
 */

class DngExporter {
  /**
   * 16-bit 무손실 TIFF 마스터 파일 생성 (RGB 채널당 16비트 = 48비트 풀컬러)
   */
  static encodeTIFF16(pixels16, width, height) {
    const numPixels = width * height;
    const stripBytes = numPixels * 3 * 2; // RGB 각 2바이트 (16-bit)
    
    const headerSize = 8;
    const numEntries = 12;
    const ifdSize = 2 + numEntries * 12 + 4;
    const extraDataOffset = headerSize + ifdSize;
    
    const extraDataSize = 6 + 32; // BitsPerSample(6) + Software(32)
    const imageOffset = extraDataOffset + extraDataSize;
    const totalSize = imageOffset + stripBytes;

    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);

    // 1. TIFF 헤더
    view.setUint16(0, 0x4949, true); // Little Endian 'II'
    view.setUint16(2, 42, true);     // TIFF Magic 42
    view.setUint32(4, 8, true);      // First IFD Offset (8)

    // 2. IFD 엔트리
    let offset = 8;
    view.setUint16(offset, numEntries, true);
    offset += 2;

    let extraOffset = extraDataOffset;

    const writeEntry = (tag, type, count, valueOrOffset) => {
      view.setUint16(offset, tag, true);
      view.setUint16(offset + 2, type, true);
      view.setUint32(offset + 4, count, true);
      view.setUint32(offset + 8, valueOrOffset, true);
      offset += 12;
    };

    writeEntry(0x00FE, 4, 1, 0); // NewSubfileType
    writeEntry(0x0100, 4, 1, width); // ImageWidth
    writeEntry(0x0101, 4, 1, height); // ImageLength

    // BitsPerSample (16, 16, 16)
    const bpsOffset = extraOffset;
    new Uint16Array(buffer, bpsOffset, 3).set([16, 16, 16]);
    extraOffset += 6;
    writeEntry(0x0102, 3, 3, bpsOffset);

    writeEntry(0x0103, 3, 1, 1); // Compression (1: Uncompressed)
    writeEntry(0x0106, 3, 1, 2); // PhotometricInterpretation (2: RGB)
    writeEntry(0x0111, 4, 1, imageOffset); // StripOffsets
    writeEntry(0x0115, 3, 1, 3); // SamplesPerPixel (3)
    writeEntry(0x0116, 4, 1, height); // RowsPerStrip
    writeEntry(0x0117, 4, 1, stripBytes); // StripByteCounts
    writeEntry(0x011C, 3, 1, 1); // PlanarConfiguration

    // Software Tag (0x0131)
    const softStr = "SemiLightroom 16-bit Master\0";
    const softOffset = extraOffset;
    for (let i = 0; i < softStr.length; i++) {
      view.setUint8(softOffset + i, softStr.charCodeAt(i));
    }
    extraOffset += 32;
    writeEntry(0x0131, 2, softStr.length, softOffset);

    view.setUint32(offset, 0, true); // Next IFD Offset (0)

    // 3. 16-bit RGB 픽셀 데이터 쓰기 (pixels16: Uint16Array or Uint8ClampedArray)
    const imgView16 = new Uint16Array(buffer, imageOffset, numPixels * 3);
    let srcIdx = 0;
    let dstIdx = 0;

    for (let i = 0; i < numPixels; i++) {
      if (pixels16 instanceof Uint16Array) {
        imgView16[dstIdx++] = pixels16[srcIdx];
        imgView16[dstIdx++] = pixels16[srcIdx + 1];
        imgView16[dstIdx++] = pixels16[srcIdx + 2];
      } else {
        // 8-bit to 16-bit High-Precision Bit Expansion
        imgView16[dstIdx++] = (pixels16[srcIdx] << 8) | pixels16[srcIdx];
        imgView16[dstIdx++] = (pixels16[srcIdx + 1] << 8) | pixels16[srcIdx + 1];
        imgView16[dstIdx++] = (pixels16[srcIdx + 2] << 8) | pixels16[srcIdx + 2];
      }
      srcIdx += 4; // RGBA -> RGB
    }

    return buffer;
  }

  /**
   * 16-bit Adobe DNG RAW 마스터 파일 생성
   */
  static encodeDNG16(pixels16, width, height) {
    const numPixels = width * height;
    const stripBytes = numPixels * 3 * 2; // RGB 16-bit (6바이트)
    
    const headerSize = 8;
    const numEntries = 18;
    const ifdSize = 2 + numEntries * 12 + 4;
    
    const extraDataOffset = headerSize + ifdSize;
    const bitsPerSample = new Uint16Array([16, 16, 16]); // 6 바이트
    const dngVersion = new Uint8Array([1, 4, 0, 0]);
    const dngBackwardVersion = new Uint8Array([1, 1, 0, 0]);
    const colorMatrix1 = new Int32Array([
      10000, 10000, 0, 10000, 0, 10000,
      0, 10000, 10000, 10000, 0, 10000,
      0, 10000, 0, 10000, 10000, 10000
    ]);

    const extraDataSize = 6 + 4 + 4 + 72 + 32;
    const imageOffset = extraDataOffset + extraDataSize;
    const totalSize = imageOffset + stripBytes;

    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);

    view.setUint16(0, 0x4949, true);
    view.setUint16(2, 42, true);
    view.setUint32(4, 8, true);

    let offset = 8;
    view.setUint16(offset, numEntries, true);
    offset += 2;

    let extraOffset = extraDataOffset;

    const writeEntry = (tag, type, count, valueOrOffset) => {
      view.setUint16(offset, tag, true);
      view.setUint16(offset + 2, type, true);
      view.setUint32(offset + 4, count, true);
      view.setUint32(offset + 8, valueOrOffset, true);
      offset += 12;
    };

    writeEntry(0x00FE, 4, 1, 0);
    writeEntry(0x0100, 4, 1, width);
    writeEntry(0x0101, 4, 1, height);

    const bpsOffset = extraOffset;
    new Uint16Array(buffer, bpsOffset, 3).set(bitsPerSample);
    extraOffset += 6;
    writeEntry(0x0102, 3, 3, bpsOffset);

    writeEntry(0x0103, 3, 1, 1);
    writeEntry(0x0106, 3, 1, 2);
    writeEntry(0x0111, 4, 1, imageOffset);
    writeEntry(0x0112, 3, 1, 1);
    writeEntry(0x0115, 3, 1, 3);
    writeEntry(0x0116, 4, 1, height);
    writeEntry(0x0117, 4, 1, stripBytes);
    writeEntry(0x011C, 3, 1, 1);

    const verOffset = extraOffset;
    new Uint8Array(buffer, verOffset, 4).set(dngVersion);
    extraOffset += 4;
    writeEntry(50706, 1, 4, verOffset);

    const bVerOffset = extraOffset;
    new Uint8Array(buffer, bVerOffset, 4).set(dngBackwardVersion);
    extraOffset += 4;
    writeEntry(50707, 1, 4, bVerOffset);

    const modelStr = "SemiLightroom 16-bit DNG Master\0";
    const modelOffset = extraOffset;
    for (let i = 0; i < modelStr.length; i++) {
      view.setUint8(modelOffset + i, modelStr.charCodeAt(i));
    }
    extraOffset += 32;
    writeEntry(50708, 2, modelStr.length, modelOffset);

    const cmOffset = extraOffset;
    new Int32Array(buffer, cmOffset, 18).set(colorMatrix1);
    extraOffset += 72;
    writeEntry(50721, 10, 9, cmOffset);

    view.setUint32(offset, 0, true);

    const imgView16 = new Uint16Array(buffer, imageOffset, numPixels * 3);
    let srcIdx = 0;
    let dstIdx = 0;

    for (let i = 0; i < numPixels; i++) {
      if (pixels16 instanceof Uint16Array) {
        imgView16[dstIdx++] = pixels16[srcIdx];
        imgView16[dstIdx++] = pixels16[srcIdx + 1];
        imgView16[dstIdx++] = pixels16[srcIdx + 2];
      } else {
        imgView16[dstIdx++] = (pixels16[srcIdx] << 8) | pixels16[srcIdx];
        imgView16[dstIdx++] = (pixels16[srcIdx + 1] << 8) | pixels16[srcIdx + 1];
        imgView16[dstIdx++] = (pixels16[srcIdx + 2] << 8) | pixels16[srcIdx + 2];
      }
      srcIdx += 4;
    }

    return buffer;
  }

  static encodeRGB(pixels, width, height) {
    return this.encodeDNG16(pixels, width, height);
  }
}

window.DngExporter = DngExporter;
