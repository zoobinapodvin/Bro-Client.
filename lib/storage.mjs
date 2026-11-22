import { get, put, list, head, BlobNotFoundError, BlobPreconditionFailedError } from '@vercel/blob';
export const bucket = {
  async get(path) {
    const result = await get(path, {access:'private',useCache:false});
    if (!result) return null;
    return {etag: result.blob.etag, body: result.stream, httpMetadata:{contentType:result.blob.contentType}, json:()=>new Response(result.stream).json()};
  },
  async put(path, value, options={}) {
    const condition=options.onlyIf;
    const createOnly=condition?.etagDoesNotMatch==='*';
    try {
      return await put(path,value,{access:'private',addRandomSuffix:false,allowOverwrite:!createOnly,ifMatch:condition?.etagMatches,contentType:options.httpMetadata?.contentType||'application/json'});
    } catch(error) {
      if(error instanceof BlobPreconditionFailedError || (createOnly && /already exists/i.test(error.message))) return null;
      throw error;
    }
  },
  async head(path) {try{return await head(path);}catch(error){if(error instanceof BlobNotFoundError)return null;throw error;}},
  async list(options) {const page=await list(options);return {objects:page.blobs.map(b=>({key:b.pathname})),truncated:page.hasMore,cursor:page.cursor};}
};
