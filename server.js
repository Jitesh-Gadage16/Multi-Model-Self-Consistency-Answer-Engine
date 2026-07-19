
// create api to call this function

import express from 'express';
import cors from 'cors';
import { getBestAnswer } from './index.js';

const app = express();
const port = 4000;

app.use(cors());
app.use(express.json());

app.post('/api/getBestAnswer', async (req, res) => {
    const { userInput } = req.body;
    if (!userInput) {
        return res.status(400).json({ error: "Missing 'userInput' in request body." });
    }

    try {
        const { individualAnswers, bestAnswer } = await getBestAnswer(userInput);
        res.json({ individualAnswers, bestAnswer });
    } catch (error) {
        console.error("API Error:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});