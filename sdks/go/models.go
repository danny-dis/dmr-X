package dmrx

// ModelsList returns all available models.
// This is a convenience wrapper that delegates to Client.ListModels.
func (c *Client) ModelsList() (*ModelList, error) {
	return c.ListModels()
}

// ModelsGet returns a single model by ID.
// This is a convenience wrapper that delegates to Client.GetModel.
func (c *Client) ModelsGet(modelID string) (*Model, error) {
	return c.GetModel(modelID)
}
