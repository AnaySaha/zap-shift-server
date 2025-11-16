const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const admin = require("firebase-admin");
const stripe = require('stripe');

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

// Initialize Stripe
const stripeClient = stripe(process.env.PAYMENT_GATEWAY_KEY);

// Middlewares
app.use(cors());
app.use(express.json());

// MongoDB connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.y56bxor.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const db = client.db('parcelDB');
    const usersCollection = db.collection('users')
    const parcelCollection = db.collection('parcels');
    const paymentCollection = db.collection('payments');

    // custom middlewares


const serviceAccount = require("./firebase-admin-key.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});



    const verifyFBToken = async(req, res, next) => {
     const authHeader = req.headers.authorization;
     if(!authHeader){
      return res.status(401).send({message: 'unauthoized access'})
     }

     const token = authHeader.split('')[1];
     if(!token){
       return res.status(401).send({message: 'unauthoized access'})
     }

    //  verify the token

      next();
    }



    app.post('/users', async (req, res) =>{
      const email = req.body.email;
      const userExists = await usersCollection.findOne({ email })
      if (userExists){
        return res.status(200).send({message: 'User already exists',
          inserted: false
        });
      }

      const user = req.body;
      const result = await usersCollection.insertOne(user);
      res.send(result);

    })


    // ✅ Get all or user-specific parcels
    app.get("/parcels", async (req, res) => {
      try {
        const userEmail = req.query.email;
        const query = userEmail ? { created_by: userEmail } : {};
        const parcels = await parcelCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();
        res.status(200).json(parcels);
      } catch (error) {
        console.error("Error fetching parcels:", error);
        res.status(500).json({ message: "Error fetching parcels", error: error.message });
      }
    });

    // ✅ Create a new parcel
    app.post("/parcels", async (req, res) => {
      try {
        const newParcel = { ...req.body, createdAt: new Date() };
        const result = await parcelCollection.insertOne(newParcel);
        res.status(201).json({ success: true, id: result.insertedId });
      } catch (error) {
        console.error("Error inserting parcel:", error);
        res.status(500).json({ success: false, message: "Failed to create parcel" });
      }
    });

    // ✅ Get single parcel by ID
    app.get("/parcels/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid parcel ID" });
        }

        const parcel = await parcelCollection.findOne({ _id: new ObjectId(id) });
        if (!parcel) {
          return res.status(404).json({ message: "Parcel not found" });
        }

        res.status(200).json(parcel);
      } catch (error) {
        console.error("Error fetching parcel by ID:", error);
        res.status(500).json({ message: "Error fetching parcel by ID", error: error.message });
      }
    });

    // ✅ Delete parcel by ID
    app.delete("/parcels/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid parcel ID" });
        }

        const result = await parcelCollection.deleteOne({ _id: new ObjectId(id) });
        res.status(200).json(result);
      } catch (error) {
        console.error("Error deleting parcel:", error);
        res.status(500).json({ message: "Failed to delete parcel" });
      }
    });

    app.post("/tracking", async(req, res) => {
      const {tracking_id, parcel_id, status, message, updated_by=''} =
      req.body;

      const log = {
        tracking_id,
        parcel_id: parcel_id ? new ObjectId(parcel_id) : undefined,
        status,
        message,
        time: new Date(),
        updated_by,
      };

      const result = await trackingCollection.insertOne(log);
      res.send({ success: true, insertedId: result.insertedId})
    });




    // ✅ Get payment history (user or all for admin)
    app.get('/payments', verifyFBToken, async (req, res) => {

      
      try {
        const userEmail = req.query.email;
        const query = userEmail ? { email: userEmail } : {};
        const payments = await paymentCollection
          .find(query)
          .sort({ createdAt: -1 }) // latest first
          .toArray();
        res.status(200).json(payments);
      } catch (error) {
        console.error('Error fetching payment history:', error);
        res.status(500).json({ message: 'Failed to get payments' });
      }
    });

    // ✅ Save payment + mark parcel as paid
    app.post('/payments', async (req, res) => {
      try {
        const payment = req.body;
        paymentData.createdAt = new Date(); // ✅ timestamp for frontend table

        // Save payment record
        const result = await paymentCollection.insertOne(payment);

        // Mark parcel as paid (if parcelId exists)
        const parcelId = payment.parcelId;
        if (parcelId && ObjectId.isValid(parcelId)) {
          await parcelCollection.updateOne(
            { _id: new ObjectId(parcelId) },
            {
              $set: {
                payment_status: 'paid',
                transactionId: payment.transactionId,
                updatedAt: new Date(),
              },
            }
          );
        }

        res.status(201).json({ success: true, insertedId: result.insertedId });
      } catch (error) {
        console.error("Error saving payment:", error);
        res.status(500).json({ message: "Failed to record payment" });
      }
    });

    // ✅ Stripe payment intent creation
    app.post('/create-payment-intent', async (req, res) => {
      const amountInCents = req.body.amountInCents;
      if (!amountInCents || isNaN(amountInCents)) {
        return res.status(400).json({ error: 'Invalid payment amount' });
      }

      try {
        const paymentIntent = await stripeClient.paymentIntents.create({
          amount: amountInCents,
          currency: 'usd',
          payment_method_types: ['card'],
        });

        res.json({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        console.error('Error creating payment intent:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // ✅ MongoDB connection test
    await client.db("admin").command({ ping: 1 });
    console.log("✅ Successfully connected to MongoDB");
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error);
  }
}

run().catch(console.dir);

// ✅ Root route
app.get("/", (req, res) => {
  res.send("🚀 Parcel server is running successfully!");
});

// ✅ Start server
app.listen(port, () => {
  console.log(`✅ Server is running on port ${port}`);
});
