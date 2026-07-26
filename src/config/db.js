import mongoose from 'mongoose';
import dotenv from 'dotenv';

// Load environment variables (useful if running this file standalone for tests)
dotenv.config();

/**
 * Establishes a connection to MongoDB Atlas.
 * 
 * In production backend systems, we want robust error handling for databases.
 * We listen to connection events (connected, error, disconnected) to log the database status,
 * which helps in debugging network drops or authentication failures.
 */
export const connectDB = async () => {
  try {
    const connUri = process.env.MONGO_URI;
    
    if (!connUri) {
      console.error('CRITICAL ERROR: MONGO_URI is not defined in the environment variables.');
      process.exit(1);
    }

    // Connect to MongoDB Atlas
    const conn = await mongoose.connect(connUri);

    console.log(`MongoDB Connected successfully to Cluster Host: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Database Connection Failed. Error Details: ${error.message}`);
    // Exit process with failure code (1) if database connection fails at start
    process.exit(1);
  }
};

// Listen to connection state changes (useful for production monitoring)
mongoose.connection.on('disconnected', () => {
  console.warn('Warning: MongoDB disconnected. Re-connection attempts may be in progress.');
});

mongoose.connection.on('error', (err) => {
  console.error(`MongoDB connection error occurred: ${err}`);
});
