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
                // call the updateMetadata function here with the question data
                await updateMetaData(processedQuestions);
                
            //     matchSubtopic(question.question_data, metadata.data)
            //         .then(subtopic => {
            //             console.log(`Matching subtopic for question ID ${q_id}:`, subtopic);
                        
            //             if (subtopic) {
            //                 question.sub_topic_id = subtopic.sub_topic_id;
            //                 question.topic_id = subtopic.topic_id;
            //                 question.subject_id = subtopic.subject_id;
            //             } else {
            //                 console.warn(`No matching subtopic found for question ID ${q_id}`);
            //             }
            //         })
            //         .catch(err => {
            //             console.error(`Error matching subtopic for question ID ${q_id}:`, err);
            //         });  
            }
        }

        // Return the processed question data
        res.json({
            count: processedQuestions.length,
            questions: processedQuestions
        });

    } catch (error) {
        console.error('Error occurred:', error?.response?.data || error);
        res.status(500).send('An error occurred while processing questions', error);
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
