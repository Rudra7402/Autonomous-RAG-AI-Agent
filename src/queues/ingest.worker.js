import { Worker } from 'bullmq';
import fs from 'fs';
import path from 'path';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { INGEST_QUEUE_NAME } from './ingest.queue.js';
import { queueConnectionOptions } from '../config/queue.js';
import { embeddings } from '../services/llm.service.js';
import { DocumentChunk } from '../models/document.model.js';

/**
 * Document Ingestion Worker Process
 * 
 * This background worker consumes ingestion jobs from Redis, performing the RAG data preparation pipeline:
 * 1. Load document (PDF / Text) from temporary disk path.
 * 2. Split text into chunks using RecursiveCharacterTextSplitter (with overlap).
 * 3. Generate 768-dimensional vector embeddings using Google Gemini.
 * 4. Save text chunks + embeddings + metadata into MongoDB Atlas.
 * 5. Clean up temporary uploaded file from server disk.
 */

const processIngestionJob = async (job) => {
  const { filePath, fileName, fileSize, mimeType, sessionId, userId } = job.data;
  console.log(`[Worker] Started processing job #${job.id}: ${fileName} (Session: ${sessionId || 'Universal'})`);

  try {
    // Step 1: Load Document
    job.updateProgress(10);
    let docs = [];

    if (mimeType === 'application/pdf' || filePath.endsWith('.pdf')) {
      try {
        const loader = new PDFLoader(filePath, { splitPages: false });
        docs = await loader.load();
      } catch (err) {
        throw new Error(`Failed to parse PDF. It might be corrupted or password-protected.`);
      }
    } else {
      // Fallback for plain text files
      const textContent = fs.readFileSync(filePath, 'utf-8');
      docs = [{ pageContent: textContent, metadata: {} }];
    }

    if (!docs || docs.length === 0 || !docs[0].pageContent.trim()) {
      throw new Error(`Document ${fileName} contains no readable text content.`);
    }

    const fullText = docs.map(d => d.pageContent).join('\n\n');

    // Step 2: Split text into chunks with overlap
    job.updateProgress(30);
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,      // Max characters per chunk
      chunkOverlap: 200     // Overlap characters between chunks to preserve context
    });

    const chunkDocs = await splitter.createDocuments([fullText]);
    console.log(`[Worker] Document ${fileName} split into ${chunkDocs.length} chunks.`);

    // Step 3: Extract chunk text strings and generate embeddings
    job.updateProgress(50);
    const chunkTexts = chunkDocs.map(c => c.pageContent);

    // Call Google Gemini Embeddings API (batch mode)
    const vectorArrays = await embeddings.embedDocuments(chunkTexts);

    // Step 4: Construct Mongoose documents for bulk insertion into MongoDB Atlas
    job.updateProgress(80);
    const mongoDocuments = chunkDocs.map((doc, index) => ({
      content: doc.pageContent,
      embedding: vectorArrays[index],
      metadata: {
        fileName,
        sessionId: sessionId || null,
        userId: userId || 'anonymous',
        chunkIndex: index,
        totalChunks: chunkDocs.length,
        fileSize,
        mimeType
      }
    }));

    // Bulk insert into MongoDB Atlas
    await DocumentChunk.insertMany(mongoDocuments);
    console.log(`[Worker] Successfully stored ${mongoDocuments.length} vector chunks in MongoDB Atlas.`);

    // Step 5: Clean up temporary file from local server disk
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[Worker] Temporary file deleted: ${filePath}`);
    }

    job.updateProgress(100);
    return {
      status: 'completed',
      fileName,
      totalChunksStored: mongoDocuments.length
    };

  } catch (error) {
    console.error(`[Worker] Ingestion Job #${job.id} failed: ${error.message}`);
    // Clean up temporary file even on error
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    throw error;
  }
};

// Instantiate the BullMQ Worker
export const ingestWorker = new Worker(INGEST_QUEUE_NAME, processIngestionJob, {
  connection: queueConnectionOptions,
  concurrency: 2 // Process up to 2 files simultaneously
});

// Worker Event Listeners
ingestWorker.on('completed', (job, result) => {
  console.log(`[Worker Event] Job #${job.id} (${result.fileName}) completed successfully.`);
});

ingestWorker.on('failed', (job, err) => {
  console.error(`[Worker Event] Job #${job?.id} failed with error: ${err.message}`);
});
