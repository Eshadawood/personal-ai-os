declare module "pdf-parse" {
  const parse: (buffer: Buffer) => Promise<{ text: string }>;
  export default parse;
}
