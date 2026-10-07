declare module "utif" {
  interface IFD {
    width: number;
    height: number;
    data: Uint8Array;
    [key: string]: any;
  }
  const UTIF: {
    decode(data: ArrayBuffer): IFD[];
    decodeImage(data: ArrayBuffer, ifd: IFD): void;
    toRGBA8(ifd: IFD): Uint8Array;
  };
  export default UTIF;
}
