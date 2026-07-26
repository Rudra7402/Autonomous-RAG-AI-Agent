import { ingestQueue } from '../queues/ingest.queue.js';

/**
 * Controller: Upload Document & Push to Queue
 * Endpoint: POST /api/ingest
 * 
 * Handles incoming file upload requests, validates file presence,
 * pushes the ingestion task to BullMQ, and returns an immediate HTTP 202 Accepted response.
 */
export const uploadDocumentController = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'No file uploaded. Please attach a document under the field "file".'
      });
    }

    const { path: filePath, originalname: fileName, size: fileSize, mimetype: mimeType } = req.file;
    const { sessionId } = req.body;
    const userId = req.user?.userId || 'anonymous';

    // Push task into BullMQ with chat isolation support!
    const job = await ingestQueue.add('process-document', {
      filePath,
      fileName,
      fileSize,
      mimeType,
      sessionId: sessionId || null,
      userId
    });

    return res.status(202).json({
      message: 'Document upload accepted and queued for background processing.',
      jobId: job.id,
      status: 'queued',
      statusCheckUrl: `/api/ingest/status/${job.id}`
    });

  } catch (error) {
    console.error(`[Ingest Controller] Error queuing upload: ${error.message}`);
    return res.status(500).json({
      error: 'Failed to process document upload.',
      details: error.message
    });
  }
};

/**
 * Controller: Check Ingestion Job Progress
 * Endpoint: GET /api/ingest/status/:jobId
 * 
 * Allows frontend clients to poll job progress (waiting -> active -> completed/failed).
 */
export const getJobStatusController = async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = await ingestQueue.getJob(jobId);

    if (!job) {
      return res.status(404).json({
        error: `Job with ID ${jobId} not found in queue.`
      });
    }

    const state = await job.getState();
    const progress = job.progress;
    const returnvalue = job.returnvalue;
    const failedReason = job.failedReason;

    return res.status(200).json({
      jobId: job.id,
      status: state,
      progress: `${progress}%`,
      result: returnvalue || null,
      error: failedReason || null
    });

  } catch (error) {
    console.error(`[Job Status Controller] Error fetching status: ${error.message}`);
    return res.status(500).json({
      error: 'Failed to retrieve job status.',
      details: error.message
    });
  }
};
