﻿/*
 * Copyright (c) 2016 - now David Sehnal, licensed under Apache 2.0, See LICENSE file for more info.
 */

namespace LiteMol.Core.Formats.Density.CCP4 {
    
    export function parse(buffer: ArrayBuffer) {
        return Parser.parse(buffer);
    }


    /**
     * Parses CCP4 files.
     */
    namespace Parser {

        function getArray(r: (offset: number) => number, offset: number, count: number) {
            let ret:number[] = [];
            for (let i = 0; i < count; i++) {
                ret[i] = r(offset + i);
            }
            return ret;
        }

        /**
         * Parse CCP4 file according to spec at http://www.ccp4.ac.uk/html/maplib.html
         * Inspired by PyMOL implementation of the parser.
         */
        export function parse(buffer: ArrayBuffer): ParserResult<Data> {
            let headerSize = 1024,
                endian = false,
                headerView = new DataView(buffer, 0, headerSize),
                warnings: string[] = [];

            let mode = headerView.getInt32(3 * 4, false);
            if (mode !== 2) {
                endian = true;
                mode = headerView.getInt32(3 * 4, true);
                if (mode !== 2) {
                    return ParserResult.error<Data>("Only CCP4 modes 0 and 2 are supported.");
                }
            }

            let readInt = (o: number) => headerView.getInt32(o * 4, endian), readFloat = (o: number) => headerView.getFloat32(o * 4, endian);
            let header = {
                extent: getArray(readInt, 0, 3),
                mode: mode,
                nxyzStart: getArray(readInt, 4, 3),
                grid: getArray(readInt, 7, 3),
                cellDimensions: getArray(readFloat, 10, 3),
                cellAngles: getArray(readFloat, 13, 3),
                crs2xyz: getArray(readInt, 16, 3),
                min: readFloat(19),
                max: readFloat(20),
                mean: readFloat(21),
                spacegroupNumber: readInt(22),
                symBytes: readInt(23),
                skewFlag: readInt(24),
                skewMatrix: getArray(readFloat, 25, 9),
                skewTranslation: getArray(readFloat, 34, 3),
                origin2k: getArray(readFloat, 49, 3)
            };

            let dataOffset = buffer.byteLength - 4 * header.extent[0] * header.extent[1] * header.extent[2];

            if (dataOffset !== headerSize + header.symBytes) {
                if (dataOffset === headerSize) {
                    warnings.push("File contains bogus symmetry record.");
                } else if (dataOffset < headerSize) {
                    return ParserResult.error<Data>("File appears truncated and doesn't match header.");
                } else if ((dataOffset > headerSize) && (dataOffset < (1024 * 1024))) {
                    // Fix for loading SPIDER files which are larger than usual
                    // In this specific case, we must absolutely trust the symBytes record
                    dataOffset = headerSize + header.symBytes;
                    warnings.push("File is larger than expected and doesn't match header. Continuing file load, good luck!");
                } else {
                    return ParserResult.error<Data>("File is MUCH larger than expected and doesn't match header.");
                }
            }

            //let mapp = readInt(52);
            //let mapStr = String.fromCharCode((mapp & 0xFF)) + String.fromCharCode(((mapp >> 8) & 0xFF)) + String.fromCharCode(((mapp >> 16) & 0xFF)) + String.fromCharCode(((mapp >> 24) & 0xFF));
            
            // pretend we've checked the MAP string at offset 52
            // pretend we've read the symmetry data
            
            if (header.grid[0] === 0 && header.extent[0] > 0) {
                header.grid[0] = header.extent[0] - 1;
                warnings.push("Fixed X interval count.");
            }
            if (header.grid[1] === 0 && header.extent[1] > 0) {
                header.grid[1] = header.extent[1] - 1;
                warnings.push("Fixed Y interval count.");
            }
            if (header.grid[2] === 0 && header.extent[2] > 0) {
                header.grid[2] = header.extent[2] - 1;
                warnings.push("Fixed Z interval count.");
            }

            if (header.crs2xyz[0] === 0 && header.crs2xyz[1] === 0 && header.crs2xyz[2] === 0) {
                warnings.push("All crs2xyz records are zero. Setting crs2xyz to 1, 2, 3.");
                header.crs2xyz = [1, 2, 3];
            }

            if (header.cellDimensions[0] === 0.0 &&
                header.cellDimensions[1] === 0.0 &&
                header.cellDimensions[2] === 0.0) {
                warnings.push("Cell dimensions are all zero. Setting to 1.0, 1.0, 1.0. Map file will not align with other structures.");
                header.cellDimensions[0] = 1.0;
                header.cellDimensions[1] = 1.0;
                header.cellDimensions[2] = 1.0;
            }

            let alpha = (Math.PI / 180.0) * header.cellAngles[0],
                beta = (Math.PI / 180.0) * header.cellAngles[1],
                gamma = (Math.PI / 180.0) * header.cellAngles[2];

            let xScale = header.cellDimensions[0] / header.grid[0],
                yScale = header.cellDimensions[1] / header.grid[1],
                zScale = header.cellDimensions[2] / header.grid[2];

            let z1 = Math.cos(beta),
                z2 = (Math.cos(alpha) - Math.cos(beta) * Math.cos(gamma)) / Math.sin(gamma),
                z3 = Math.sqrt(1.0 - z1 * z1 - z2 * z2);

            let xAxis = [xScale, 0.0, 0.0],
                yAxis = [Math.cos(gamma) * yScale, Math.sin(gamma) * yScale, 0.0],
                zAxis = [z1 * zScale, z2 * zScale, z3 * zScale];
            
            let indices = [0, 0, 0];
            indices[header.crs2xyz[0] - 1] = 0;
            indices[header.crs2xyz[1] - 1] = 1;
            indices[header.crs2xyz[2] - 1] = 2;
                        
            let origin: number[];
            if (header.origin2k[0] === 0.0 && header.origin2k[1] === 0.0 && header.origin2k[2] === 0.0) {
                origin = [
                    xAxis[0] * header.nxyzStart[indices[0]] + yAxis[0] * header.nxyzStart[indices[1]] + zAxis[0] * header.nxyzStart[indices[2]],
                                                              yAxis[1] * header.nxyzStart[indices[1]] + zAxis[1] * header.nxyzStart[indices[2]],
                                                                                                        zAxis[2] * header.nxyzStart[indices[2]]
                ];
            } else {
                // Use ORIGIN records rather than old n[xyz]start records
                //   http://www2.mrc-lmb.cam.ac.uk/image2000.html
                // XXX the ORIGIN field is only used by the EM community, and
                //     has undefined meaning for non-orthogonal maps and/or
                //     non-cubic voxels, etc.
                origin = [header.origin2k[indices[0]], header.origin2k[indices[1]], header.origin2k[indices[2]]]
            }

            let extent = [header.extent[indices[0]], header.extent[indices[1]], header.extent[indices[2]]];

            let skewMatrix = new Float32Array(16), i: number, j: number;
            for (i = 0; i < 3; i++) {
                for (j = 0; j < 3; j++) {
                    skewMatrix[4 * j + i] = header.skewMatrix[3 * i + j];
                }
                skewMatrix[12 + i] = header.skewTranslation[i];
            }
            
            let nativeEndian = new Uint16Array(new Uint8Array([0x12, 0x34]).buffer)[0] === 0x3412;
            let rawData =
                endian === nativeEndian
                    ? readRawData1(new Float32Array(buffer, headerSize + header.symBytes, extent[0] * extent[1] * extent[2]), endian, extent, header.extent, indices, header.mean)
                    : readRawData(new DataView(buffer, headerSize + header.symBytes), endian, extent, header.extent, indices, header.mean);
            
            let field = new Field3DZYX(<any>rawData.data, extent);                    
                                     
            let data = Data.create(
                header.cellDimensions, header.cellAngles, origin,
                header.skewFlag !== 0, <any>skewMatrix, field, extent,
                { x: xAxis, y: yAxis, z: zAxis },
                //[header.nxyzStart[indices[0]], header.nxyzStart[indices[1]], header.nxyzStart[indices[2]]],
                { min: header.min, max: header.max, mean: header.mean, sigma: rawData.sigma },
                { spacegroupIndex: header.spacegroupNumber - 1 });
            
            return ParserResult.success(data, warnings);
        }

        function readRawData1(view: Float32Array, endian: boolean, extent: number[], headerExtent: number[], indices: number[], mean: number): { data: Float32Array, sigma: number } {
            let data = new Float32Array(extent[0] * extent[1] * extent[2]),
                coord = [0, 0, 0],
                mX: number, mY: number, mZ: number,
                cX: number, cY: number, cZ: number,
                xSize: number, xySize: number,
                offset = 0, v = 0.1, sigma = 0.0, t = 0.1,
                iX = indices[0], iY = indices[1], iZ = indices[2];

            //mX = extent[indices[0]];
            //mY = extent[indices[1]];  
            //mZ = extent[indices[2]];
            mX = headerExtent[0];
            mY = headerExtent[1];
            mZ = headerExtent[2];

            xSize = extent[0];
            xySize = extent[0] * extent[1];
            
            for (cZ = 0; cZ < mZ; cZ++) {
                coord[2] = cZ;
                for (cY = 0; cY < mY; cY++) {
                    coord[1] = cY;
                    for (cX = 0; cX < mX; cX++) {
                        coord[0] = cX;
                        v = view[offset];
                        t = v - mean;
                        sigma += t * t,
                        data[coord[iX] + coord[iY] * xSize + coord[iZ] * xySize] = v;
                        offset += 1;
                    }
                }
            }

            sigma /= mX * mY * mZ;
            sigma = Math.sqrt(sigma);

            return {
                data: data,
                sigma: sigma
            };
        }


        function readRawData(view: DataView, endian: boolean, extent: number[], headerExtent: number[], indices: number[], mean: number): { data: Float32Array, sigma: number } {
            let data = new Float32Array(extent[0] * extent[1] * extent[2]),
                coord = [0, 0, 0],
                mX: number, mY: number, mZ: number,
                cX: number, cY: number, cZ: number,
                xSize: number, xySize: number,
                offset = 0, v = 0.1, sigma = 0.0, t = 0.1,
                iX = indices[0], iY = indices[1], iZ = indices[2];
            
            mX = headerExtent[0];
            mY = headerExtent[1];
            mZ = headerExtent[2];

            xSize = extent[0];
            xySize = extent[0] * extent[1];

            for (cZ = 0; cZ < mZ; cZ++) {
                coord[2] = cZ;
                for (cY = 0; cY < mY; cY++) {
                    coord[1] = cY;
                    for (cX = 0; cX < mX; cX++) {
                        coord[0] = cX;
                        v = view.getFloat32(offset, endian);
                        t = v - mean;
                        sigma += t * t,
                        data[coord[iX] + coord[iY] * xSize + coord[iZ] * xySize] = v;
                        offset += 4;
                    }
                }
            }

            sigma /= mX * mY * mZ;
            sigma = Math.sqrt(sigma);

            return {
                data: data,
                sigma: sigma
            };
        }
    }

}