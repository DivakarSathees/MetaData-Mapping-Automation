const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();
const { jsonrepair } = require("jsonrepair");
const { aiMetaDataMatcher } = require('./aiMetaDataMatcher');
const { updateMetaData } = require('./updateMetaData');
const app = express();
const port = 3000;
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


app.post('/metadata-mapping', async (req, res) => {
    const authToken = req.body.authToken || req.query.authToken;
    const qb_id = req.body.qb_id || req.query.qb_id;

    if (!authToken) return res.status(400).send('Auth token is required');
    if (!qb_id) return res.status(400).send('Question bank ID is required');

    try {
        // Step 1: Fetch metadata mapping (not used directly in this block, but kept for future use)
        const metadataResponse = await axios.get('https://api.examly.io/api/getalldetails', {
            headers: {
                "Authorization": authToken,
                "Content-Type": "application/json",
                "Accept": "application/json"
            }
        });
        const metadata = metadataResponse.data;
        const cleanedMetadata = metadata.data.map(entry => ({
            sub_topic_id: entry.sub_topic_id,
            sub_topic_name: entry.name.toLowerCase().trim(),
            topic_id: entry.topic.topic_id,
            topic_name: entry.topic.name.toLowerCase().trim(),
            subject_id: entry.topic.subject.subject_id,
            subject_name: entry.topic.subject.name.toLowerCase().trim()
        }));
        console.log(`Metadata mapping fetched successfully`);

        // Step 2: Fetch questions using qb_id
        const questionResponse = await axios.post(
            'https://api.examly.io/api/v2/questionfilter',
            {
                "qb_id": qb_id,
                "type": "Single",
                "page": 1,
                "limit": 1000
            },
            {
                headers: {
                    "Authorization": authToken,
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                }
            }
        );

        const questions = questionResponse.data;
        const processedQuestions = [];
        

        async function getSingleQuesInfo(q_id) {
            try {
                const response = await axios.get(`https://api.examly.io/api/project_question/${q_id}`, {
                    headers: {
                        "Authorization": authToken,
                        "Content-Type": "application/json",
                        "Accept": "application/json"
                    }
                });                
                return response.data;
            } catch (error) {
                console.error(`Error fetching question info for ID ${q_id}:`, error?.response?.data || error.message);
                return null; // Return null if there's an error
            }
        }

        async function getSingleMCQQuesInfo(q_id) {
            try {
                const response = await axios.get(`https://api.examly.io/api/mcq_question/${q_id}`, {
                    headers: {
                        "Authorization": authToken,
                        "Content-Type": "application/json",
                        "Accept": "application/json"
                    }
                });
                return response.data;
            } catch (error) {
                console.error(`Error fetching MCQ question info for ID ${q_id}:`, error?.response?.data || error.message);
                return null; // Return null if there's an error
            }
        }

        async function cleanText(html) {
            return html
                .replace(/<[^>]+>/g, '')       // remove HTML tags
                .replace(/\$\$\$.*$/, '')      // remove $$$ and beyond
                .replace(/\s+/g, ' ')          // normalize whitespace
                .toLowerCase().trim();
        }


        if (questions?.non_group_questions && Array.isArray(questions.non_group_questions)) {
            for (const question of questions.non_group_questions) {
                const q_id = question.q_id;

                if (question.question_type === 'project_question') {
                    // Fetch additional information for project questions
                    const info = await getSingleQuesInfo(q_id);
                    if (!info) {
                        console.error(`Failed to fetch project question details for ID ${q_id}`);
                        continue; // Skip processing this question if fetching fails
                    }
                    question.src_directory = info.answer.src_directory;
                    question.test_directory = info.answer.test_directory;
                }

                // if(question.question_type === 'mcq_single_correct'){
                //     const data = await getSingleMCQQuesInfo(q_id);
                //     if (!data) {
                //         console.error(`Failed to fetch MCQ question details for ID ${q_id}`);
                //         continue; // Skip processing this question if fetching fails
                //     }
                //     console.log(data);
                    
                //     question.options = data.data.entity.options[0].options || [];
                // }

                console.log(`Processing question ID: ${q_id}`);
                // console.log(metadata.data);   
                const {bestSubTopicId} = await aiMetaDataMatcher(question.question_data, metadata.data);
                console.log(`Subtopic ID for question ID ${q_id}:`, bestSubTopicId.id);
                if (bestSubTopicId) {
                    question.sub_topic_id = bestSubTopicId.id;
                    question.topic_id = bestSubTopicId.topic_id;
                    question.subject_id = bestSubTopicId.subject_id;
                    question.sub_topic_name = bestSubTopicId.sub_topic;
                    question.topic_name = bestSubTopicId.top;
                    question.subject_name = bestSubTopicId.subject;
                } else {
                    console.warn(`No matching subtopic found for question ID ${q_id}`);
                }
                

                processedQuestions.push({
                    q_id: q_id,
                    question_type: question.question_type,
                    subject_id: question.subject_id || null,
                    topic_id: question.topic_id || null,
                    sub_topic_id: question.sub_topic_id || null,
                    question_data: question.question_data,
                    question_editor_type: question.question_editor_type,
                    sub_topic_name: question.sub_topic_name || null,
                    topic_name: question.topic_name || null,
                    subject_name: question.subject_name || null,
                    // options: question.question_type === 'mcq_single_correct'
                    //     ? (typeof question.options === 'string'
                    //         ? JSON.parse(question.options)
                    //         : (question.options || []))
                    //     : [],
                    blooms_taxonomy: question.blooms_taxonomy || null,
                    // course_outcomes: question.course_outcomes || [],
                    // program_outcomes: question.program_outcomes || [],
                    // answer_explanation: question.answer_explanation || '',
                    manual_difficulty: question.manual_difficulty || null,
                    linked_concepts: question.linked_concepts || "",
                    hint: question.hints || [],
                    // tags: question.tags || [],
                    tags: Array.isArray(question.tags) ? question.tags.map(tag => tag.name) : [],
                    // has_auto_evaluation: question.question_type === 'project_question' ? question.project_questions.has_auto_evaluation : false,
                    // config: question.question_type === 'project_question' ? question.project_questions.config : null,
                    // boilerPlate: question.question_type === 'project_question' ? question.project_questions.boilerPlate : null,
                    // evaluation_type: question.question_type === 'project_question' ? question.project_questions.evaluation_type : null,
                    question_media: question.question_media || [],
                    createdBy: question.createdBy || null,
                    // image: question.question_type === 'project_question' ? question.project_questions.image : null,
                    // node_pool: question.question_type === 'project_question' ? question.project_questions.node_pool : null,
                    // themes: question.question_type === 'project_question' ? question.project_questions.themes : [],
                    // src_directory: question.question_type === 'project_question' ? question.src_directory : null,
                    // test_directory: question.question_type === 'project_question' ? question.test_directory : null,
                    ...(question.question_type === 'project_question' && {
                        has_auto_evaluation: question.project_questions.has_auto_evaluation,
                        config: question.project_questions.config,
                        boilerPlate: question.project_questions.boilerPlate,
                        evaluation_type: question.project_questions.evaluation_type,
                        image: question.project_questions.image,
                        node_pool: question.project_questions.node_pool,
                        themes: question.project_questions.themes || [],
                        src_directory: question.src_directory || null,
                        test_directory: question.test_directory || null
                    }),
                    ...(question.question_type === 'mcq_single_correct' && {
                        answer_explanation: question.answer_explanation || ''
                    })
                });
            }
        }
        // Step 3: Update metadata for each question
        const updateResults = await updateMetaData(processedQuestions, authToken);

        // Return the processed question data
        res.json({
            processedQuestions,
            updateResults
        });

    } catch (error) {
        console.error('Error occurred:', error?.response?.data || error);
        res.status(500).send('An error occurred while processing questions', error);
    }
});

// Endpoint to fetch Qbs with post method
app.post('/fetch-qbs', async (req, res) => {
    const authToken = req.body.authToken || req.query.authToken;

    if (!authToken) return res.status(400).send('Auth token is required');

    try {
        const response = await axios.post('https://api.examly.io/api/v2/questionbanks',
            {
                "branch_id": "all",
                "search": `${req.body.search || ''}`,
                "limit": 5000,
                "page": 1,
                "visibility": "All",
                "mainDepartmentUser": true,
                "department_id": [
                    "617346bd-b9c8-468d-9099-12170fb3b570",
                    "8c9bb195-1e81-4506-bc39-c48e6450c2a0",
                    "58efa904-a695-4c14-8335-124c9ec5e95a",
                    "4b375029-26ec-4d20-bf46-1122dfc584ae",
                    "d40c4d09-8ac5-4a26-b969-ce9cc8685180",
                    "e0f02ce1-486b-4122-8f1b-d80f7076bee3",
                    "04c14795-d8b2-41c0-9c41-997a5630f455",
                    "074cbc54-a20f-4a5d-9c02-1ca6a1bed28f",
                    "da3f5269-34b1-49c4-8d38-30c18b4f6598",
                    "f04c0f04-f6d7-434d-b8c9-5c356805ffab",
                    "f0b8af1b-288a-4b41-97b1-27447014ada3",
                    "2b60843d-7972-4235-82cb-0ebc33d75d63",
                    "78b66861-c946-4d83-9754-75c32925b5a9",
                    "5d1e18e7-b9aa-4d43-93b3-eb0a7a3df0d6",
                    "82208516-6d07-4fc0-8ee4-4205601c6695",
                    "b55a5b74-7f4a-428e-a59b-377dd8c7e4ba",
                    "35700f99-19f6-42c2-a336-d32687690e4a",
                    "c47b433a-7f1d-4014-a5b9-415187ed118b",
                    "fb751a89-c97a-47a6-9795-a33b3ba2eede",
                    "c02099c7-354a-48a9-867c-91cd16c6de38",
                    "4bb74161-364a-4012-9122-be5597db9f9e",
                    "a9ac9b80-daf9-45c3-aa4e-3aecd0a3820b",
                    "91f6683d-2512-416a-a355-2c6eefe9507b",
                    "6aa4e718-9fd9-4911-85c0-b900eed73547",
                    "2d24fa30-2621-418b-9597-0442ff8997df",
                    "5d4d3d63-73cd-4b04-a579-6c4f9fdf7473",
                    "55faaca8-4375-4bc6-874e-740dbf3dd22e",
                    "e100cac4-4586-4f3a-b598-24ee8d6c7a92",
                    "ffa1501f-1747-4ea7-9b83-22b3ab409d51",
                    "97c0a54a-67d2-4bc6-87b6-74b369e15889",
                    "627f1e5a-3e5e-4e14-b948-eab0baf714c4",
                    "d7d9bd6a-7bdc-46aa-8929-458e674f94c5",
                    "c3d1f72d-aa83-4276-9976-c5fcb06f70f8",
                    "4bf536a6-a9fa-4215-a803-056f0074e3e7",
                    "2680fe23-89dc-4035-a7a6-eb1869630f81",
                    "1dce25ce-cb7a-4826-a7e4-ab4c189bf436",
                    "e641144f-f801-4f79-8f3b-cff27ab3a123",
                    "7296cb61-76ce-4064-8928-328f2a545666",
                    "48942306-1e80-4db5-bd3b-e3075202d9b8",
                    "0ba8c5fa-9754-4d7f-851a-aa4791b9b445",
                    "8b0329c3-626e-4644-b6f4-dcb0424ed9fa",
                    "969b5384-e5ac-46aa-996b-547e5c77c3bf",
                    "41b64d5f-bb55-47a7-ad77-208e27ccae80",
                    "0400731b-2ab3-4644-828e-7c1618b23aac",
                    "e024b5b6-d6db-4fe6-a445-8b49facf10bb",
                    "d5c3f38f-fc70-4ac8-af83-372cd006396f",
                    "09f0cbe3-5c20-4c75-9c50-b4ee6fa6d09a",
                    "8154bcaa-3ee6-423f-938e-e4ccfe6002a7",
                    "4d037902-f46b-4fcf-824a-8f65376dbdcc",
                    "4ced5ede-47de-42b8-a5e3-a5af9d0ce415",
                    "566994d3-6a6f-4174-899a-700468f4bc7a",
                    "ebd40260-e32b-4367-8b8f-c606793e423b",
                    "6adf26cd-4949-4501-99c4-336401d84b49",
                    "64195871-472d-4520-839b-be0b8cbf2a94",
                    "4af00c09-f6a8-4099-8699-1c6a57db677b",
                    "0eb0005e-01b2-412a-a325-d0ea0ab9d64c",
                    "282bae70-ecb4-469a-94d0-8df0917b6ed4",
                    "62024afb-ea1e-4a6b-ad01-cbf1e592ed3c",
                    "662bd1f5-9c20-411a-aad0-e00e1881a6f2",
                    "54d15165-fc20-4e2e-bc1a-19e46c6a6f30",
                    "3f3711bd-ba73-404a-b72a-dee82166d2b4",
                    "a17c1837-80dd-4d0f-9a05-629e8f00eeb5",
                    "617ce4f5-33ec-4ff6-b1a6-1c74220be379",
                    "bf6ce3d6-8552-4959-bc65-9068c8f7738b",
                    "3f0fd32e-4290-488f-8e93-ba49d4dc1ecd",
                    "51827123-a24e-4aac-a23b-cbf3b95177e5",
                    "7a309bfc-d490-4269-8c36-f2899e02de65",
                    "9a64ffc7-47af-4f28-8dfa-31718a16ea7b",
                    "bd3777c4-635f-435a-94da-3426f786d592",
                    "6204bdfd-9a00-42b5-b951-0ab9a7a22105",
                    "173df851-7e75-43f1-9185-19028621a66f",
                    "e9fecb8e-8553-4d23-ac96-eca3da15af90",
                    "8eeae087-ce46-4d8a-9d0d-aefef190f0cd",
                    "00522911-f5fa-48fd-acb2-333b40117b82",
                    "41698284-bb61-4f6c-aaf1-591182d9025d",
                    "901ff1b8-cc03-4bb3-96b9-42bb53e86701",
                    "5c490195-95f7-4577-a9cb-3096d940af5d",
                    "1b18fbbf-a4ca-45df-ab78-75480a154b4a",
                    "ef6771c4-b9f5-4593-b4f6-ae9cd8845ec2",
                    "b073f250-c7eb-4d6b-829e-3af6ceb94037",
                    "78dc3377-b4a2-4338-b17e-6d8dde7cfeb1",
                    "ba75398b-44ce-487a-9dcd-f57339241e8d",
                    "a09496c9-0412-4649-944f-2edca43cb252",
                    "756c5ccf-535e-4b26-8d5f-3acc607e9a81",
                    "34c1f447-25af-4a75-9abf-be10d1626076",
                    "82156a68-a333-4217-8ac6-4863dd04d457",
                    "e329730f-6efb-47d0-a86c-04e764487a28",
                    "47e36ac4-0185-41c2-992c-d18c57d4a331",
                    "9783c0ce-d618-4909-adf9-79b2c9d2f10e",
                    "55cd2a51-53b1-47a3-9869-56e3d6bba559",
                    "c5758329-0590-4b1f-8447-f64d20c21b96",
                    "1abc3b49-cb7a-4d1d-a507-69fd139e57ae",
                    "61164b98-a492-4009-b2a9-9c94f01ef8a8",
                    "f650e3df-80fa-4e27-b254-3dd802a071a7",
                    "015b365f-9bcd-41c4-92fd-9e3e475cbdac",
                    "281d8e09-ea24-4aee-9d62-bb945c33fc7a",
                    "9f1b6c5b-ff23-4c7e-b3e6-576f36f893d5",
                    "3610abcc-b6f4-4a8e-b593-77c165755778",
                    "9697e209-d83d-41f3-a51b-8de4de0bbe54",
                    "9a4a2f10-f5bd-420f-a71c-3e25f70c2ceb",
                    "cfeff396-511e-472b-bd3f-288dff86a343",
                    "151656b3-5b14-4397-a293-8c8962ef1075",
                    "c8f816f8-836d-4fe6-9ad6-d48fe5fd372d",
                    "5473cf88-4fca-4b1c-a978-b1c25589654c",
                    "b7ec2e38-e5e8-44f1-9427-229b4c15c443",
                    "8f5f4ff5-6322-414f-a26d-38a2ebaaaf58",
                    "ad35005d-9bb8-4e59-8df6-c4a164d4be1f",
                    "9c95a180-5ae6-4109-b5bf-ca28b3f45c53",
                    "c1323b4a-12ec-4906-86d2-fcbc4cc261be",
                    "5eba9f0f-94be-45c5-b811-b351b9e81a2d",
                    "d4dee91f-ee3f-4153-a78f-2114bf3e5b56",
                    "b5c43777-62fb-4841-8044-df9635e168a5",
                    "b55f9101-3379-4f7d-8ee5-be8c4662b73d",
                    "705909cd-368f-4d89-8bc4-b88e545448aa",
                    "6591339a-64fd-419b-82a2-01b4198184f7",
                    "e9280c07-148f-4634-86fd-566e2b99ca95",
                    "7ce72cef-ca43-47b2-ab98-b98e08c3fd86",
                    "48a4f5de-81d3-414d-95c7-b5697e4ec0c7",
                    "cb36e5e9-8a8e-4986-9a66-f5f42449042c",
                    "c7952fcf-7717-455a-bde4-c91cb60049af",
                    "e57f0a5b-0175-4515-afdc-03b328c10d67",
                    "b2fa115a-7a45-44da-801c-db58b8bca7fc",
                    "7ef066c2-1ec3-4d01-bc63-9bb6656db39d",
                    "2bdda40a-c0bd-45df-8a82-746c2b20b2da",
                    "bacc7663-1f43-42f6-b8dc-4c66acb4297b",
                    "27f62bde-822a-4c0f-ad8e-045040b8e934",
                    "31ae9c6f-27fe-4663-9990-73386e96629a",
                    "8505dbb5-5f20-4ecd-8f48-7420ae03f534",
                    "c2115608-5c5e-43bb-81ed-bcbe6abd5ea4",
                    "a7cf5456-3f82-4806-bf09-6f44e1fcab21"
                ]
            },
            {  headers: {
                "Authorization": authToken,
                "Content-Type": "application/json",
                "Accept": "application/json"
            }
        });
        const qbs = response.data;
        res.json(qbs);
    } catch (error) {
        console.error('Error fetching QBs:', error?.response?.data || error);
        res.status(500).send('An error occurred while fetching QBs');
    }
});


app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
